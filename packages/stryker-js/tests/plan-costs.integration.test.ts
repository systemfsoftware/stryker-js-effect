import { Gherkin, Given, it, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import { Engine } from '@systemfsoftware/stryker-js'
import { ShardPlan } from '@systemfsoftware/stryker-js-cli-contract'
import { Report } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Arr from 'effect/Array'
import * as Effect from 'effect/Effect'
import * as Fiber from 'effect/Fiber'
import * as FileSystem from 'effect/FileSystem'
import * as Option from 'effect/Option'
import * as Order from 'effect/Order'
import * as Path from 'effect/Path'
import * as ChildProcess from 'effect/process/ChildProcess'
import * as ChildProcessSpawner from 'effect/process/ChildProcessSpawner'
import * as S from 'effect/Schema'
import * as Scope from 'effect/Scope'
import * as Stream from 'effect/Stream'

import { recordedDryRunMsOf } from './__fixtures__/recorded-dry-run.schema.js'
import { storedVerdictsIn } from './__fixtures__/stored-verdicts.fixture.js'

const Feature = makeFeature({ it })

const STRYKER_BIN = decodeURIComponent(new URL('../dist/main.mjs', import.meta.url).pathname)

const PACKAGE_ROOT = decodeURIComponent(new URL('..', import.meta.url).pathname).replace(/\/$/, '')

const PARTICIPANT = '{ "type": "commonjs" }\n'

const CONFIG = `export default {
  testRunner: 'vm',
  testFiles: ['test/**/*.mjs'],
  mutate: ['src/**/*.js'],
  reporters: ['json'],
  checkers: [],
  concurrency: 1,
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

const ALPHA_EDIT = `${ALPHA_SOURCE}\n// the developer edits this file\n`

const INCREMENTAL_FILE = 'reports/stryker-incremental.json'

const MUTATION_REPORT_FILE = 'reports/mutation/mutation.json'

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

interface PlanObservation {
  readonly shardCount: number
  readonly predictedSeconds: number
  readonly ids: readonly string[]
}

const sortedIds = (ids: readonly string[]): readonly string[] => Arr.sort(Arr.dedupe(ids), Order.String)

const planObservationOf = (text: string): PlanObservation =>
  Option.match(decodePlan(text), {
    onNone: (): PlanObservation => ({ shardCount: 0, predictedSeconds: 0, ids: [] }),
    onSome: (plan): PlanObservation => ({
      shardCount: plan.shards.length,
      predictedSeconds: Arr.reduce(plan.shards, 0, (total, shard) => total + shard.predictedSeconds),
      ids: sortedIds(plan.shards.flatMap((shard) => shard.projects.flatMap((project) => project.mutants.map(String)))),
    }),
  })

const decodeMutationReport = S.decodeUnknownOption(S.fromJsonString(Report.MutationTestResult))

type ReportedMutant = Report.MutationTestResult['files'][string]['mutants'][number]

const mutantsOf = (reported: Report.MutationTestResult): readonly ReportedMutant[] =>
  Object.values(reported.files).flatMap((file) => file.mutants)

const runsWholeSuite = (mutant: ReportedMutant): boolean =>
  mutant.static === true || (mutant.coveredBy ?? []).length === 0

const costedMillisecondsOf = (costMsById: Record<string, number>, ids: readonly string[]): number =>
  Arr.reduce(ids, 0, (total, id) => total + (costMsById[id] ?? 0))

interface Fixture {
  readonly root: string
}

const makeFixture = (): Effect.Effect<Fixture, never, FileSystem.FileSystem | Path.Path | Scope.Scope> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const root = yield* fs.realPath(yield* fs.makeTempDirectoryScoped({ prefix: 'stryker-plan-costs-' }))
    yield* fs.makeDirectory(path.join(root, 'src'))
    yield* fs.makeDirectory(path.join(root, 'test'))
    yield* fs.writeFileString(path.join(root, 'package.json'), PARTICIPANT)
    yield* fs.writeFileString(path.join(root, 'stryker.config.mjs'), CONFIG)
    yield* fs.writeFileString(path.join(root, 'src', 'alpha.js'), ALPHA_SOURCE)
    yield* fs.writeFileString(path.join(root, 'src', 'beta.js'), BETA_SOURCE)
    yield* fs.writeFileString(path.join(root, 'test', 'alpha.test.mjs'), ALPHA_TEST)
    yield* fs.writeFileString(path.join(root, 'test', 'beta.test.mjs'), BETA_TEST)
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
    return { root }
  }).pipe(Effect.orDie)

interface CostsOutcome {
  readonly run: ExecOutcome
  readonly quietPlanExitCode: number
  readonly editedPlanExitCode: number
  readonly quiet: PlanObservation
  readonly edited: PlanObservation
  readonly runIds: readonly string[]
  readonly expectedEditedMs: number
  readonly editedMutantsMs: number
  readonly allMutantsMs: number
}

const runPlanEditPlan = (
  fixture: Fixture,
): Effect.Effect<
  CostsOutcome,
  never,
  FileSystem.FileSystem | Path.Path | Scope.Scope | ChildProcessSpawner.ChildProcessSpawner
> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const { root } = fixture
    const run = yield* spawnCli(root, ['run'])
    const reported = Option.getOrThrow(
      decodeMutationReport(yield* fs.readFileString(path.join(root, MUTATION_REPORT_FILE))),
    )
    const reportText = yield* fs.readFileString(path.join(root, INCREMENTAL_FILE))
    const runIds = sortedIds(mutantsOf(reported).map((mutant) => mutant.id))
    const alphaIds = sortedIds(
      reported.files['src/alpha.js']?.mutants.map((mutant) => mutant.id) ?? [],
    )
    const wholeSuiteIds = sortedIds(mutantsOf(reported).filter(runsWholeSuite).map((mutant) => mutant.id))
    const stored = yield* storedVerdictsIn({ projectRoot: root, mutantIds: runIds })
    const costMsById = Object.fromEntries(Object.entries(stored).map(([id, verdict]) => [id, verdict.costMs] as const))
    const editedMutantsMs = costedMillisecondsOf(costMsById, Arr.dedupe([...alphaIds, ...wholeSuiteIds]))
    const quietPlan = yield* spawnCli(root, [
      'plan',
      '--target-seconds',
      '300',
      '--max-shards',
      '20',
      '--out',
      'plan-quiet.json',
    ])
    yield* fs.writeFileString(path.join(root, 'src', 'alpha.js'), ALPHA_EDIT)
    const editedPlan = yield* spawnCli(root, [
      'plan',
      '--target-seconds',
      '300',
      '--max-shards',
      '20',
      '--out',
      'plan-edited.json',
    ])
    return {
      run,
      quietPlanExitCode: quietPlan.exitCode,
      editedPlanExitCode: editedPlan.exitCode,
      quiet: planObservationOf(yield* fs.readFileString(path.join(root, 'plan-quiet.json'))),
      edited: planObservationOf(yield* fs.readFileString(path.join(root, 'plan-edited.json'))),
      runIds,
      expectedEditedMs: editedMutantsMs + recordedDryRunMsOf(reportText),
      editedMutantsMs,
      allMutantsMs: costedMillisecondsOf(costMsById, runIds),
    }
  }).pipe(Effect.orDie)

Feature('Planning the shard costs of reused mutants', { timeout: 180_000 })
  .withLayer(Engine.nodePlatformLayer)
  .live('the built stryker binary runs a full run and two plans over a temp project')
  .body(({ scenario }) => {
    scenario(
      'A plan prices only the mutants a run will execute',
      Gherkin.Do.pipe(
        Given('a project whose two source files are each covered by their own test file')(
          'fixture',
          () => makeFixture(),
        ),
        When('the full run, an unchanged plan, a source edit, and a second plan follow')(
          'outcome',
          (s) => runPlanEditPlan(s.fixture),
        ),
        Then(
          'the unchanged plan schedules every mutant at zero seconds and the edited plan prices only the changed closure',
        )(
          (s, expect) => {
            const { outcome } = s
            return expect({
              runExitCode: outcome.run.exitCode,
              quietPlanExitCode: outcome.quietPlanExitCode,
              editedPlanExitCode: outcome.editedPlanExitCode,
              quietIds: outcome.quiet.ids,
              quietShardCount: outcome.quiet.shardCount,
              quietPredictedSeconds: outcome.quiet.predictedSeconds,
              editedIds: outcome.edited.ids,
              editedShardCount: outcome.edited.shardCount,
              editedMilliseconds: Math.round(outcome.edited.predictedSeconds * 1000),
              expectedEditedMilliseconds: Math.round(outcome.expectedEditedMs),
              someMutantsNeedNoRun: outcome.editedMutantsMs < outcome.allMutantsMs,
            }).toEqual({
              runExitCode: 0,
              quietPlanExitCode: 0,
              editedPlanExitCode: 0,
              quietIds: outcome.runIds,
              quietShardCount: 1,
              quietPredictedSeconds: 0,
              editedIds: outcome.runIds,
              editedShardCount: 1,
              editedMilliseconds: Math.round(outcome.expectedEditedMs),
              expectedEditedMilliseconds: Math.round(outcome.expectedEditedMs),
              someMutantsNeedNoRun: true,
            })
          },
        ),
      ),
    )
  })
