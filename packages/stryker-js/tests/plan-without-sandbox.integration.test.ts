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
import * as S from 'effect/Schema'
import * as Scope from 'effect/Scope'
import * as Stream from 'effect/Stream'

const Feature = makeFeature({ it })

const STRYKER_BIN = decodeURIComponent(new URL('../dist/main.mjs', import.meta.url).pathname)

const CONSUMER_PACKAGE = '{ "name": "plan-without-sandbox-consumer", "type": "module", "private": true }\n'

const CONFIG = `export default {
  testRunner: 'command',
  commandRunner: { command: 'true' },
  mutate: ['src/**/*.js'],
  coverageAnalysis: 'off',
  concurrency: 1,
  reporters: [],
  cleanTempDir: false,
}
`

const MUTABLE_SOURCES: readonly string[] = [
  '(a, b) => a + b',
  '(a, b) => a > b ? a : b',
  '(a, b) => a && b',
  '(a, b) => `${a}-${b}`',
]

const sourceOf = (index: number): string =>
  MUTABLE_SOURCES.map((expression, fn) => `export const fn${index}_${fn} = ${expression}\n`).join('')

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

const decodeTested = S.decodeUnknownOption(S.fromJsonString(RunEvent.RunMutantTested))

const testedIdsOfStream = (text: string): readonly string[] =>
  text.split('\n')
    .flatMap((line) => Option.toArray(decodeTested(line.trim())))
    .map((tested) => tested.id)

const decodePlan = S.decodeUnknownOption(S.fromJsonString(ShardPlan))

const plannedIdsOf = (text: string): readonly string[] =>
  Option.match(decodePlan(text), {
    onNone: () => [],
    onSome: (plan) => plan.shards.flatMap((shard) => shard.projects.flatMap((project) => project.mutants.map(String))),
  })

const sortedIds = (ids: readonly string[]): readonly string[] => Arr.sort(Arr.dedupe(ids), Order.String)

interface Fixture {
  readonly root: string
}

const makeFixture = (): Effect.Effect<Fixture, never, FileSystem.FileSystem | Path.Path | Scope.Scope> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const root = yield* fs.realPath(yield* fs.makeTempDirectoryScoped({ prefix: 'stryker-plan-sandbox-' }))
    yield* fs.makeDirectory(path.join(root, 'src'))
    yield* fs.writeFileString(path.join(root, 'package.json'), CONSUMER_PACKAGE)
    yield* fs.writeFileString(path.join(root, 'stryker.config.mjs'), CONFIG)
    yield* Effect.forEach(
      Array.from({ length: 40 }, (_, index) => index),
      (index) => fs.writeFileString(path.join(root, 'src', `mod${index}.js`), sourceOf(index)),
      { discard: true },
    )
    return { root }
  }).pipe(Effect.orDie)

const sandboxArtifactsIn = (root: string): Effect.Effect<readonly string[], never, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const tempDirName = '.stryker-tmp'
    const entries = yield* fs.readDirectory(root).pipe(Effect.orElseSucceed(() => []))
    const tempEntries = yield* fs.exists(path.join(root, tempDirName)).pipe(
      Effect.flatMap((there) =>
        there
          ? fs.readDirectory(path.join(root, tempDirName)).pipe(Effect.orElseSucceed(() => []))
          : Effect.succeed<ReadonlyArray<string>>([])
      ),
    )
    return [
      ...entries.filter((entry) => entry === tempDirName),
      ...tempEntries.filter((entry) => entry.startsWith('sandbox-')).map((entry) => `${tempDirName}/${entry}`),
    ]
  }).pipe(Effect.orDie)

interface Outcome {
  readonly planExitCode: number
  readonly runExitCode: number
  readonly sandboxArtifactsAfterPlan: readonly string[]
  readonly plannedIds: readonly string[]
  readonly testedIds: readonly string[]
  readonly output: string
}

const planThenRun = (
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
    const plan = yield* spawnCli(root, ['plan', '--target-seconds', '300', '--max-shards', '20', '--out', 'plan.json'])
    const sandboxArtifactsAfterPlan = yield* sandboxArtifactsIn(root)
    const run = yield* spawnCli(root, ['run'])
    const stream = yield* fs.readFileString(path.join(root, 'reports', 'mutation-stream.jsonl')).pipe(
      Effect.orElseSucceed(() => ''),
    )
    const planText = yield* fs.readFileString(path.join(root, 'plan.json')).pipe(Effect.orElseSucceed(() => ''))
    return {
      planExitCode: plan.exitCode,
      runExitCode: run.exitCode,
      sandboxArtifactsAfterPlan,
      plannedIds: sortedIds(plannedIdsOf(planText)),
      testedIds: sortedIds(testedIdsOfStream(stream)),
      output: `${plan.output}\n${run.output}`,
    }
  }).pipe(Effect.orDie)

Feature('Planning shards without materializing a sandbox')
  .withLayer(Engine.nodePlatformLayer)
  .live('the built stryker binary plans and runs a generated temp project')
  .body(({ scenario }) => {
    scenario(
      'A plan leaves no sandbox behind and schedules exactly the mutants a full run reports',
      Gherkin.Do.pipe(
        Given('a project with 40 mutable source files')('fixture', () => makeFixture()),
        When('the plan runs, the project is inspected, and a full mutation run follows')(
          'outcome',
          (s) => planThenRun(s.fixture),
        ),
        Then('the plan left no sandbox and its mutant ids equal the run\u2019s')((s, expect) =>
          expect({
            planExitCode: s.outcome.planExitCode,
            runExitCode: s.outcome.runExitCode,
            sandboxArtifactsAfterPlan: s.outcome.sandboxArtifactsAfterPlan,
            plannedNonEmpty: s.outcome.plannedIds.length > 0,
            plannedIds: s.outcome.plannedIds,
          }).toEqual({
            planExitCode: 0,
            runExitCode: 0,
            sandboxArtifactsAfterPlan: [],
            plannedNonEmpty: true,
            plannedIds: s.outcome.testedIds,
          })
        ),
      ),
    )
  })
