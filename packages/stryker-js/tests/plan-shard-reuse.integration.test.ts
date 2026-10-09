import { Gherkin, Given, it, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import { Engine } from '@systemfsoftware/stryker-js'
import { RunEvent, ShardPlan } from '@systemfsoftware/stryker-js-cli-contract'
import * as Arr from 'effect/Array'
import * as Effect from 'effect/Effect'
import * as Fiber from 'effect/Fiber'
import * as FileSystem from 'effect/FileSystem'
import * as Option from 'effect/Option'
import * as Order from 'effect/Order'
import * as Path from 'effect/Path'
import * as ChildProcess from 'effect/process/ChildProcess'
import * as ChildProcessSpawner from 'effect/process/ChildProcessSpawner'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import * as Scope from 'effect/Scope'
import * as Stream from 'effect/Stream'

const Feature = makeFeature({ it })

const STRYKER_BIN = decodeURIComponent(new URL('../dist/main.mjs', import.meta.url).pathname)

const PROJECT_NAMES = ['proj-a', 'proj-b'] as const

const INCREMENTAL_FILE = 'reports/stryker-incremental.json'

const PACKAGE_ROOT = decodeURIComponent(new URL('..', import.meta.url).pathname).replace(/\/$/, '')

const PARTICIPANT = '{ "type": "commonjs" }\n'

const CONFIG = `export default {
  testRunner: 'vm',
  testFiles: ['test/**/*.mjs'],
  mutate: ['src/**/*.js'],
  coverageAnalysis: 'perTest',
  incremental: true,
  incrementalFile: 'reports/stryker-incremental.json',
  checkers: [],
  concurrency: 1,
  reporters: [],
  cleanTempDir: 'always',
}
`

const ALPHA_SOURCE = [
  'function add(left, right) {',
  '  return left + right;',
  '}',
  '',
  'function label() {',
  "  return 'alpha';",
  '}',
  '',
  'module.exports = { add, label };',
  '',
].join('\n')

const BETA_SOURCE = [
  'function double(value) {',
  '  return value * 2;',
  '}',
  '',
  'module.exports = { double };',
  '',
].join('\n')

const ALPHA_TEST = [
  "import { expect, test } from 'vitest'",
  "import alpha from '../src/alpha.js'",
  '',
  "test('adds two numbers', () => {",
  '  expect(alpha.add(1, 2)).toBe(3)',
  '})',
  '',
  "test('labels the alpha module', () => {",
  "  expect(alpha.label()).toBe('alpha')",
  '})',
  '',
].join('\n')

const BETA_TEST = [
  "import { expect, test } from 'vitest'",
  "import beta from '../src/beta.js'",
  '',
  "test('doubles a number', () => {",
  '  expect(beta.double(2)).toBe(4)',
  '})',
  '',
].join('\n')

interface ExecOutcome {
  readonly exitCode: number
  readonly output: string
}

const spawnCli = (
  root: string,
  args: ReadonlyArray<string>,
): Effect.Effect<ExecOutcome, never, ChildProcessSpawner.ChildProcessSpawner | Scope.Scope> =>
  Effect.scoped(
    Effect.gen(function*() {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
      const handle = yield* spawner.spawn(
        ChildProcess.make(globalThis.process.execPath, [STRYKER_BIN, ...args], {
          cwd: root,
          stdin: 'ignore',
          stdout: 'pipe',
          stderr: 'pipe',
          env: { STRYKER_MODE: 'machine', NO_COLOR: '1', GITHUB_ACTIONS: '', ALLOW_LOCAL_MUTATION: '1' },
          extendEnv: true,
        }),
      )
      const stdout = yield* Effect.forkScoped(handle.stdout.pipe(Stream.decodeText, Stream.mkString))
      const stderr = yield* Effect.forkScoped(handle.stderr.pipe(Stream.decodeText, Stream.mkString))
      const exitCode = yield* handle.exitCode
      return {
        exitCode: Number(exitCode),
        output: `${yield* Fiber.join(stdout)}\n${yield* Fiber.join(stderr)}`,
      }
    }),
  ).pipe(Effect.orDie)

const decodePlan = S.decodeUnknownOption(S.fromJsonString(ShardPlan))

const decodePlanKnown = (line: string) => S.decodeResult(S.fromJsonString(RunEvent.PlanKnown))(line)

const planEventOf = (streamText: string): RunEvent.PlanKnown => {
  const decoded = streamText
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('{"_tag":"plan"'))
    .map(decodePlanKnown)
  const found = decoded.flatMap((result) => (Result.isSuccess(result) ? [result.success] : []))[0]
  return Option.getOrThrowWith(
    Option.fromUndefinedOr(found),
    () =>
      new Error(
        `no decodable plan event:\n${
          decoded.map((result) =>
            Result.match(result, {
              onFailure: (error) => error.message,
              onSuccess: (event) => `decoded total ${event.total}`,
            })
          ).join('\n---\n')
        }`,
      ),
  )
}

const planOf = (text: string): ShardPlan =>
  Option.getOrThrowWith(decodePlan(text), () => new Error(`not a ShardPlan: ${text.slice(0, 400)}`))

const scheduledIdsOf = (plan: ShardPlan): ReadonlyArray<string> =>
  Arr.sort(
    plan.shards.flatMap((shard) => shard.projects.flatMap((project) => project.mutants.map(String))),
    Order.String,
  )

const predictedSecondsOf = (plan: ShardPlan): number =>
  Arr.reduce(plan.shards, 0, (total, shard) => total + shard.predictedSeconds)

const projectMutantCountOf = (plan: ShardPlan): Record<string, number> =>
  Object.fromEntries(
    Arr.reduce(
      plan.shards.flatMap((shard) => shard.projects),
      new Map<string, number>(),
      (counts, entry) => counts.set(entry.project, (counts.get(entry.project) ?? 0) + entry.mutants.length),
    ),
  )

const NO_REFUSALS: RunEvent.ReuseRefusals = {
  semanticsChanged: 0,
  policyChanged: 0,
  runInputsChanged: 0,
  checkerConfigChanged: 0,
  closureChanged: 0,
  closureAnalysisFailed: 0,
  programChanged: 0,
  timeoutUnreproduced: 0,
  flakyDependency: 0,
  entryUnreadable: 0,
  storeUnavailable: 0,
  noPriorRecord: 0,
}

interface Fixture {
  readonly root: string
}

const makeFixture = (): Effect.Effect<Fixture, never, FileSystem.FileSystem | Path.Path | Scope.Scope> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const root = yield* fs.realPath(yield* fs.makeTempDirectoryScoped({ prefix: 'stryker-plan-reuse-' }))
    yield* fs.writeFileString(path.join(root, 'package.json'), PARTICIPANT)
    yield* fs.makeDirectory(path.join(root, 'node_modules'), { recursive: true })
    const installed = yield* fs.readDirectory(path.join(PACKAGE_ROOT, 'node_modules'))
    yield* Effect.forEach(
      installed,
      (entry) =>
        Effect.gen(function*() {
          const target = path.join(root, 'node_modules', entry)
          const present = yield* fs.exists(target)
          yield* Effect.when(
            fs.symlink(path.join(PACKAGE_ROOT, 'node_modules', entry), target),
            Effect.succeed(!present),
          )
        }),
      { discard: true },
    )
    yield* Effect.forEach(
      PROJECT_NAMES,
      (name) =>
        Effect.gen(function*() {
          const project = path.join(root, name)
          yield* fs.makeDirectory(path.join(project, 'src'), { recursive: true })
          yield* fs.makeDirectory(path.join(project, 'test'), { recursive: true })
          yield* fs.writeFileString(
            path.join(project, 'package.json'),
            `{ "name": "${name}", "type": "commonjs", "private": true }\n`,
          )
          yield* fs.writeFileString(path.join(project, 'stryker.config.mjs'), CONFIG)
          yield* fs.writeFileString(path.join(project, 'src', 'alpha.js'), ALPHA_SOURCE)
          yield* fs.writeFileString(path.join(project, 'src', 'beta.js'), BETA_SOURCE)
          yield* fs.writeFileString(path.join(project, 'test', 'alpha.test.mjs'), ALPHA_TEST)
          yield* fs.writeFileString(path.join(project, 'test', 'beta.test.mjs'), BETA_TEST)
        }),
      { discard: true },
    )
    return { root }
  }).pipe(Effect.orDie)

const readText = (file: string): Effect.Effect<string, never, FileSystem.FileSystem> =>
  Effect.map(FileSystem.FileSystem, (fs) => fs.readFileString(file).pipe(Effect.orElseSucceed(() => ''))).pipe(
    Effect.flatten,
  )

const shardDirsOf = (plan: ShardPlan): ReadonlyArray<string> =>
  plan.shards.map((shard) => `reports/shard-${shard.index}-of-${shard.count}`)

interface Outcome {
  readonly coldPlan: ExecOutcome
  readonly shardRuns: ReadonlyArray<ExecOutcome>
  readonly merged: ExecOutcome
  readonly warmPlan: ExecOutcome
  readonly warmPlanText: string
  readonly coldIds: ReadonlyArray<string>
  readonly warm: ShardPlan
  readonly warmReuse: RunEvent.PlanKnown
}

const planRunMergePlan = (
  fixture: Fixture,
): Effect.Effect<
  Outcome,
  never,
  FileSystem.FileSystem | Path.Path | Scope.Scope | ChildProcessSpawner.ChildProcessSpawner
> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const { root } = fixture
    const planArgs = ['plan', '--target-seconds', '0.05', '--max-shards', '4', '--projects', PROJECT_NAMES.join(',')]
    const coldPlan = yield* spawnCli(root, [...planArgs, '--out', 'plan.json'])
    const plan = planOf(yield* readText(path.join(root, 'plan.json')))
    yield* Effect.forEach(
      PROJECT_NAMES,
      (name) =>
        fs.remove(path.join(root, name, 'reports', 'mutation-stream.jsonl')).pipe(Effect.orElseSucceed(() => {})),
      { discard: true },
    )
    const shardRuns = yield* Effect.forEach(
      plan.shards,
      (shard) =>
        spawnCli(root, [
          'run',
          '--plan',
          'plan.json',
          '--shard',
          `${shard.index}/${shard.count}`,
          '--out',
          `reports/shard-${shard.index}-of-${shard.count}`,
        ]),
      { concurrency: 1 },
    )
    const merged = yield* spawnCli(root, [
      'merge',
      '--plan',
      'plan.json',
      ...shardDirsOf(plan),
      '--out',
      'reports/mutation',
    ])
    yield* Effect.forEach(
      PROJECT_NAMES,
      (name) =>
        Effect.gen(function*() {
          const source = path.join(root, 'reports', 'mutation', name, 'stryker-incremental.json')
          const target = path.join(root, name, INCREMENTAL_FILE)
          yield* fs.makeDirectory(path.dirname(target), { recursive: true })
          yield* fs.copyFile(source, target)
        }),
      { discard: true },
    )
    const warmPlan = yield* spawnCli(root, [...planArgs, '--out', 'plan-warm.json'])
    const warmPlanText = yield* readText(path.join(root, 'plan-warm.json'))
    return {
      coldPlan,
      shardRuns,
      merged,
      warmPlan,
      warmPlanText,
      coldIds: scheduledIdsOf(plan),
      warm: planOf(warmPlanText),
      warmReuse: planEventOf(warmPlan.output),
    }
  }).pipe(Effect.orDie)

Feature('Reusing recorded verdicts when planning mutation shards', { timeout: 240_000 })
  .withLayer(Engine.nodePlatformLayer)
  .live('the built stryker binary plans, shards, merges and plans again over a two-project root')
  .body(({ scenario }) => {
    scenario(
      'A repo that has not changed since its shards merged plans no work',
      Gherkin.Do.pipe(
        Given('a repo whose two projects each hold four mutable source files')(
          'fixture',
          () => makeFixture(),
        ),
        When('the binary plans the shards, runs them, merges their reports and plans again unchanged')(
          'outcome',
          (s) => planRunMergePlan(s.fixture),
        ),
        Then('the second plan schedules every mutant at zero seconds because every verdict is reused')(
          (s, expect) => {
            const { outcome } = s
            const warmIds = scheduledIdsOf(outcome.warm)
            const projectMutants = projectMutantCountOf(outcome.warm)
            const reusedProjects = Option.getOrElse(
              Option.fromUndefinedOr(outcome.warmReuse.projects),
              (): ReadonlyArray<RunEvent.PlanProjectReuse> => [],
            )
            return expect({
              coldPlanExitCode: outcome.coldPlan.exitCode,
              shardExitCodes: outcome.shardRuns.map((run) => run.exitCode),
              mergeExitCode: outcome.merged.exitCode,
              warmPlanExitCode: outcome.warmPlan.exitCode,
              coldIdsNonEmpty: outcome.coldIds.length > 0,
              shardCount: outcome.warm.shards.length,
              warmIds,
              warmPredictedSeconds: predictedSecondsOf(outcome.warm),
              reuseSummary: reusedProjects.map((project) =>
                `${project.project}: reused=${project.reused} ran=${project.ran} refused=${
                  JSON.stringify(project.refused)
                } discard=${project.discard === undefined ? 'none' : project.discard.reason}`
              ),
            }).toEqual({
              coldPlanExitCode: 0,
              shardExitCodes: outcome.shardRuns.map(() => 0),
              mergeExitCode: 0,
              warmPlanExitCode: 0,
              coldIdsNonEmpty: true,
              shardCount: outcome.warm.shards.length,
              warmIds: outcome.coldIds,
              warmPredictedSeconds: 0,
              reuseSummary: Object.entries(projectMutants)
                .sort(([left], [right]) => left.localeCompare(right))
                .map(([project, mutants]) =>
                  `${project}: reused=${mutants} ran=0 refused=${JSON.stringify(NO_REFUSALS)} discard=none`
                ),
            })
          },
        ),
      ),
    )
  })
