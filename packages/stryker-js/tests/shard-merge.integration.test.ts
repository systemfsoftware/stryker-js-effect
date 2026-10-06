import { Gherkin, Given, it, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import { Engine } from '@systemfsoftware/stryker-js'
import { RunEvent, ShardPlan } from '@systemfsoftware/stryker-js-cli-contract'
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

const Feature = makeFeature({ it })

const STRYKER_BIN = decodeURIComponent(new URL('../dist/main.mjs', import.meta.url).pathname)

const CONSUMER_PACKAGE = '{ "name": "shard-merge-consumer", "type": "module", "private": true }\n'

const CONFIG = `export default {
  testRunner: 'command',
  commandRunner: { command: 'true' },
  mutate: ['src/**/*.js'],
  coverageAnalysis: 'off',
  concurrency: 1,
  reporters: [],
}
`

interface Verdict {
  readonly id: string
  readonly status: string
}

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

const verdictsOfStream = (text: string): readonly Verdict[] =>
  text.split('\n')
    .flatMap((line) => Option.toArray(decodeTested(line.trim())))
    .map((tested): Verdict => ({ id: tested.id, status: tested.status }))

const decodeReport = S.decodeUnknownOption(S.fromJsonString(Report.MutationTestResult))

const verdictsOfReport = (text: string): readonly Verdict[] =>
  Option.match(decodeReport(text), {
    onNone: () => [],
    onSome: (report) =>
      Object.values(report.files).flatMap((file) =>
        file.mutants.map((mutant): Verdict => ({ id: mutant.id, status: mutant.status }))
      ),
  })

const planOf = (first: ReadonlyArray<string>, second: ReadonlyArray<string>): ShardPlan => ({
  version: 1,
  targetSeconds: 1,
  shards: [
    { index: 1, count: 2, predictedSeconds: 1, projects: [{ project: '.', mutants: [...first] }] },
    { index: 2, count: 2, predictedSeconds: 1, projects: [{ project: '.', mutants: [...second] }] },
  ],
  matrix: {
    include: [{ shard: '1/2', predictedSeconds: 1 }, { shard: '2/2', predictedSeconds: 1 }],
  },
})

const encodePlan = (plan: ShardPlan): Effect.Effect<string> =>
  Effect.orDie(S.encodeEffect(S.fromJsonString(ShardPlan, { space: 2 }))(plan))

interface Fixture {
  readonly root: string
  readonly unsharded: readonly Verdict[]
  readonly ids: readonly string[]
}

const prepareFixture = (): Effect.Effect<
  Fixture,
  never,
  FileSystem.FileSystem | Path.Path | Scope.Scope | ChildProcessSpawner.ChildProcessSpawner
> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const binaryPresent = yield* fs.exists(STRYKER_BIN)
    yield* Effect.when(
      Effect.die(new Error('dist/main.mjs is missing — build the package first')),
      Effect.succeed(!binaryPresent),
    )
    const root = yield* fs.realPath(yield* fs.makeTempDirectoryScoped({ prefix: 'stryker-shard-merge-' }))
    yield* fs.makeDirectory(path.join(root, 'src'))
    yield* fs.writeFileString(path.join(root, 'package.json'), CONSUMER_PACKAGE)
    yield* fs.writeFileString(path.join(root, 'src', 'add.js'), 'export const add = (a, b) => a + b\n')
    yield* fs.writeFileString(path.join(root, 'stryker.config.mjs'), CONFIG)
    const ran = yield* spawnCli(root, ['run'])
    yield* Effect.when(
      Effect.die(new Error(`unsharded run exited ${ran.exitCode}: ${ran.output}`)),
      Effect.succeed(ran.exitCode !== 0),
    )
    const stream = yield* fs.readFileString(path.join(root, 'reports', 'mutation-stream.jsonl'))
    const unsharded = verdictsOfStream(stream)
    const ids = Arr.sort(Arr.dedupe(unsharded.map((verdict) => verdict.id)), Order.String)
    const half = Math.ceil(ids.length / 2)
    const plan = planOf(ids.slice(0, half), ids.slice(half))
    yield* fs.writeFileString(path.join(root, 'plan.json'), yield* encodePlan(plan))
    return { root, unsharded, ids }
  }).pipe(Effect.orDie)

interface MergeOutcome {
  readonly merged: readonly Verdict[]
  readonly doctored: { readonly id: string; readonly exitCode: number; readonly output: string }
}

const runAndMerge = (
  fixture: Fixture,
): Effect.Effect<
  MergeOutcome,
  never,
  FileSystem.FileSystem | Path.Path | Scope.Scope | ChildProcessSpawner.ChildProcessSpawner
> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const { root, ids } = fixture
    const first = yield* spawnCli(root, ['run', '--plan', 'plan.json', '--shard', '1/2', '--out', 'reports/shard-1'])
    const second = yield* spawnCli(root, ['run', '--plan', 'plan.json', '--shard', '2/2', '--out', 'reports/shard-2'])
    yield* Effect.when(
      Effect.die(new Error(`shard runs exited ${first.exitCode}/${second.exitCode}: ${first.output}${second.output}`)),
      Effect.succeed(first.exitCode !== 0 || second.exitCode !== 0),
    )
    const merged = yield* spawnCli(root, [
      'merge',
      '--plan',
      'plan.json',
      'reports/shard-1',
      'reports/shard-2',
      '--out',
      'reports/merged',
    ])
    yield* Effect.when(
      Effect.die(new Error(`merge exited ${merged.exitCode}: ${merged.output}`)),
      Effect.succeed(merged.exitCode !== 0),
    )
    const mergedReport = yield* fs.readFileString(path.join(root, 'reports', 'merged', 'mutation.json'))
    const mergedIncremental = path.join(root, 'reports', 'merged', 'stryker-incremental.json')
    const hasMergedIncremental = yield* fs.exists(mergedIncremental)
    yield* Effect.when(
      Effect.die(new Error(`merged per-project incremental missing at ${mergedIncremental}`)),
      Effect.succeed(!hasMergedIncremental),
    )
    const duplicate = ids[0] ?? 'no-id'
    const half = Math.ceil(ids.length / 2)
    const doctoredPlan = planOf(ids.slice(0, half), [duplicate, ...ids.slice(half)])
    yield* fs.writeFileString(path.join(root, 'plan-doctored.json'), yield* encodePlan(doctoredPlan))
    yield* spawnCli(root, ['run', '--plan', 'plan-doctored.json', '--shard', '1/2', '--out', 'reports/doc-1'])
    yield* spawnCli(root, ['run', '--plan', 'plan-doctored.json', '--shard', '2/2', '--out', 'reports/doc-2'])
    const doctored = yield* spawnCli(root, [
      'merge',
      '--plan',
      'plan-doctored.json',
      'reports/doc-1',
      'reports/doc-2',
      '--out',
      'reports/doc-merged',
    ])
    return {
      merged: verdictsOfReport(mergedReport),
      doctored: { id: duplicate, exitCode: doctored.exitCode, output: doctored.output },
    }
  }).pipe(Effect.orDie)

const statusMapOf = (verdicts: readonly Verdict[]): Readonly<Record<string, string>> =>
  Object.fromEntries(
    [...verdicts].sort((left, right) => left.id.localeCompare(right.id)).map((verdict) => [verdict.id, verdict.status]),
  )

Feature('Sharded runs merge to the unsharded statuses', { timeout: 180_000 })
  .withLayer(Engine.nodePlatformLayer)
  .live('the built stryker binary runs a two-shard plan and merges it')
  .body(({ scenario }) => {
    scenario(
      'A two-shard plan merge equals the unsharded statuses and a doctored plan fails naming the duplicated id',
      Gherkin.Do.pipe(
        Given('a fixture whose unsharded run and two-shard plan are prepared')('fixture', () => prepareFixture()),
        When('the shards run and merge, and a doctored plan is merged')('outcome', (s) => runAndMerge(s.fixture)),
        Then('the merged statuses equal the unsharded ones and the doctored merge fails naming the id')(
          (s, expect) =>
            expect({
              merged: statusMapOf(s.outcome.merged),
              unsharded: statusMapOf(s.fixture.unsharded),
              doctoredFailed: s.outcome.doctored.exitCode !== 0,
              doctoredNamesId: s.outcome.doctored.output.includes(s.outcome.doctored.id),
            }).toEqual({
              merged: statusMapOf(s.fixture.unsharded),
              unsharded: statusMapOf(s.fixture.unsharded),
              doctoredFailed: true,
              doctoredNamesId: true,
            }),
        ),
      ),
    )
  })
