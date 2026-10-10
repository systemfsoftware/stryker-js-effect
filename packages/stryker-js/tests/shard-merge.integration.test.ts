import { Gherkin, Given, it, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import { Engine } from '@systemfsoftware/stryker-js'
import { RunEvent, ShardPlan } from '@systemfsoftware/stryker-js-cli-contract'
import { Mutant, Report } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Arr from 'effect/Array'
import * as Effect from 'effect/Effect'
import * as Fiber from 'effect/Fiber'
import * as FileSystem from 'effect/FileSystem'
import * as Option from 'effect/Option'
import * as Order from 'effect/Order'
import * as Path from 'effect/Path'
import * as ChildProcess from 'effect/process/ChildProcess'
import * as ChildProcessSpawner from 'effect/process/ChildProcessSpawner'
import * as Record from 'effect/Record'
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
  readonly reason: string
  readonly subsumption: string
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

const testedOfStream = (text: string): readonly RunEvent.RunMutantTested[] =>
  text.split('\n').flatMap((line) => Option.toArray(decodeTested(line.trim())))

const verdictsOfStream = (text: string): readonly Verdict[] =>
  testedOfStream(text).map((tested): Verdict => ({
    id: tested.id,
    status: tested.status,
    reason: tested.statusReason,
    subsumption: tested.subsumption === null ? '' : JSON.stringify(tested.subsumption),
  }))

const decodeReport = S.decodeUnknownOption(S.fromJsonString(Report.MutationTestResult))

const verdictsOfReport = (text: string): readonly Verdict[] =>
  Option.match(decodeReport(text), {
    onNone: () => [],
    onSome: (report) =>
      Object.values(report.files).flatMap((file) =>
        file.mutants.map((mutant): Verdict => ({
          id: mutant.id,
          status: mutant.status,
          reason: mutant.statusReason ?? '',
          subsumption: mutant['subsumption'] === undefined ? '' : JSON.stringify(mutant['subsumption']),
        }))
      ),
  })

const subsumedPairsOf = (text: string): readonly string[] =>
  testedOfStream(text).flatMap((tested) =>
    S.is(Mutant.Subsumed)(tested.subsumption) ? [tested.id, tested.subsumption.dominators[0]] : []
  )

const decodeMergedCosts = S.decodeUnknownOption(
  S.fromJsonString(S.Struct({ costs: S.optional(S.Record(S.String, S.Unknown)) })),
)

const mergedCostIdsOf = (text: string): readonly string[] =>
  Option.match(decodeMergedCosts(text), {
    onNone: () => [],
    onSome: (decoded) =>
      Arr.sort(Object.keys(Option.getOrElse(Option.fromUndefinedOr(decoded.costs), () => ({}))), Order.String),
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
    yield* fs.writeFileString(path.join(root, 'src', 'log.js'), "export const log = (a) => console.log('adding', a)\n")
    yield* fs.writeFileString(path.join(root, 'src', 'order.js'), 'export const less = (a, b) => (a < b ? 1 : 0)\n')
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
    const first = Arr.dedupe([...subsumedPairsOf(stream), ...ids.slice(0, half)])
    const plan = planOf(first, ids.filter((id) => !first.includes(id)))
    yield* fs.writeFileString(path.join(root, 'plan.json'), yield* encodePlan(plan))
    return { root, unsharded, ids }
  }).pipe(Effect.orDie)

interface MergeOutcome {
  readonly merged: readonly Verdict[]
  readonly mergedCostIds: readonly string[]
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
    const mergedCostIds = mergedCostIdsOf(yield* fs.readFileString(mergedIncremental))
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
      mergedCostIds,
      doctored: { id: duplicate, exitCode: doctored.exitCode, output: doctored.output },
    }
  }).pipe(Effect.orDie)

const statusMapOf = (verdicts: readonly Verdict[]): Readonly<Record<string, string>> =>
  Object.fromEntries(
    [...verdicts].sort((left, right) => left.id.localeCompare(right.id)).map((verdict) => [
      verdict.id,
      `${verdict.status} ${verdict.reason} ${verdict.subsumption}`,
    ]),
  )

const ruleReasonsOf = (verdicts: readonly Verdict[]): readonly string[] =>
  Arr.sort(
    Arr.dedupe(verdicts.flatMap((verdict) => verdict.status === 'Ignored' ? [verdict.reason.split(':')[0] ?? ''] : [])),
    Order.String,
  )

const decodeVerdictLine = S.decodeUnknownOption(S.fromJsonString(RunEvent.VerdictReached))

const shardActualSecondsOf = (text: string): number =>
  text.split('\n')
    .flatMap((line) => Option.toArray(decodeVerdictLine(line.trim())))
    .reduce((total, verdict) => total + verdict.budget.actualSeconds, 0)

const decodeMergedBudget = S.decodeUnknownOption(
  S.fromJsonString(S.Struct({ budget: S.optional(RunEvent.Budget) })),
)

const decodeBaselineSeconds = S.decodeUnknownOption(S.fromJsonString(S.Struct({ actualSeconds: S.Finite })))

interface BudgetOutcome {
  readonly slowestShardSeconds: number
  readonly mergedBudget: Option.Option<RunEvent.Budget>
  readonly gate: ExecOutcome
  readonly baselineSeconds: Option.Option<number>
}

const mergeAndBootstrapBudget = (
  fixture: Fixture,
): Effect.Effect<
  BudgetOutcome,
  never,
  FileSystem.FileSystem | Path.Path | Scope.Scope | ChildProcessSpawner.ChildProcessSpawner
> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const { root } = fixture
    yield* spawnCli(root, ['run', '--plan', 'plan.json', '--shard', '1/2', '--out', 'reports/budget-1'])
    yield* spawnCli(root, ['run', '--plan', 'plan.json', '--shard', '2/2', '--out', 'reports/budget-2'])
    const merged = yield* spawnCli(root, [
      'merge',
      '--plan',
      'plan.json',
      'reports/budget-1',
      'reports/budget-2',
      '--out',
      'reports/mutation',
    ])
    yield* Effect.when(
      Effect.die(new Error(`merge exited ${merged.exitCode}: ${merged.output}`)),
      Effect.succeed(merged.exitCode !== 0),
    )
    const firstStream = yield* fs.readFileString(path.join(root, 'reports', 'budget-1', 'mutation-stream.jsonl'))
    const secondStream = yield* fs.readFileString(path.join(root, 'reports', 'budget-2', 'mutation-stream.jsonl'))
    const report = yield* fs.readFileString(path.join(root, 'reports', 'mutation', 'mutation.json'))
    const gate = yield* spawnCli(root, [
      'gate',
      '--budget-baseline',
      '.stryker/budget-baseline.json',
      '--update-budget-baseline',
    ])
    const baseline = yield* Effect.option(fs.readFileString(path.join(root, '.stryker', 'budget-baseline.json')))
    return {
      slowestShardSeconds: Math.max(shardActualSecondsOf(firstStream), shardActualSecondsOf(secondStream)),
      mergedBudget: Option.flatMap(decodeMergedBudget(report), (decoded) => Option.fromUndefinedOr(decoded.budget)),
      gate,
      baselineSeconds: Option.map(
        Option.flatMap(baseline, decodeBaselineSeconds),
        (decoded) => decoded.actualSeconds,
      ),
    }
  }).pipe(Effect.orDie)

const downgradeLine = (raw: string): string =>
  Option.match(S.decodeOption(S.fromJsonString(S.Record(S.String, S.Unknown)))(raw.trim()), {
    onNone: () => raw,
    onSome: (line) =>
      Record.has(line, 'schemaVersion')
        ? JSON.stringify({ ...line, schemaVersion: '6.0' })
        : Record.has(line, 'statusReason')
        ? JSON.stringify(Record.remove(line, 'statusReason'))
        : raw,
  })

const downgradeStream = (file: string): Effect.Effect<void, never, FileSystem.FileSystem> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const text = yield* fs.readFileString(file)
    yield* fs.writeFileString(file, text.split('\n').map(downgradeLine).join('\n'))
  }).pipe(Effect.orDie)

const mergeWithDowngradedStream = (
  fixture: Fixture,
): Effect.Effect<
  ExecOutcome,
  never,
  FileSystem.FileSystem | Path.Path | Scope.Scope | ChildProcessSpawner.ChildProcessSpawner
> =>
  Effect.gen(function*() {
    const path = yield* Path.Path
    const { root } = fixture
    yield* spawnCli(root, ['run', '--plan', 'plan.json', '--shard', '1/2', '--out', 'reports/downgraded-1'])
    yield* spawnCli(root, ['run', '--plan', 'plan.json', '--shard', '2/2', '--out', 'reports/downgraded-2'])
    yield* downgradeStream(path.join(root, 'reports', 'downgraded-1', 'mutation-stream.jsonl'))
    return yield* spawnCli(root, [
      'merge',
      '--plan',
      'plan.json',
      'reports/downgraded-1',
      'reports/downgraded-2',
      '--out',
      'reports/downgraded-merged',
    ])
  }).pipe(Effect.orDie)

Feature('Sharded runs merge to the unsharded statuses', { timeout: 180_000 })
  .withLayer(Engine.nodePlatformLayer)
  .live('the built stryker binary runs a two-shard plan and merges it')
  .body(({ scenario }) => {
    scenario(
      'A two-shard plan merge equals the unsharded statuses and reasons, and a doctored plan fails naming the duplicated id',
      Gherkin.Do.pipe(
        Given('a fixture whose unsharded run and two-shard plan are prepared')('fixture', () => prepareFixture()),
        When('the shards run and merge, and a doctored plan is merged')('outcome', (s) => runAndMerge(s.fixture)),
        Then('the merged statuses, reasons, subsumption references, and costs cover every mutant')(
          (s, expect) =>
            expect({
              merged: statusMapOf(s.outcome.merged),
              mergedCostIds: s.outcome.mergedCostIds,
              mergedIgnoredRules: ruleReasonsOf(s.outcome.merged),
              subsumedInUnsharded: Object.values(statusMapOf(s.fixture.unsharded)).some((entry) =>
                entry.includes('"_tag":"Subsumed"')
              ),
              unsharded: statusMapOf(s.fixture.unsharded),
              unshardedIds: s.fixture.ids,
              doctoredFailed: s.outcome.doctored.exitCode !== 0,
              doctoredNamesId: s.outcome.doctored.output.includes(s.outcome.doctored.id),
            }).toEqual({
              merged: statusMapOf(s.fixture.unsharded),
              mergedCostIds: s.fixture.ids,
              mergedIgnoredRules: ['arid-logging', 'redundant-relational'],
              unsharded: statusMapOf(s.fixture.unsharded),
              unshardedIds: s.fixture.ids,
              doctoredFailed: true,
              subsumedInUnsharded: true,
              doctoredNamesId: true,
            }),
        ),
      ),
    )

    scenario(
      'The merged report carries the slowest shard as the run budget, so the budget gate can write its baseline',
      Gherkin.Do.pipe(
        Given('a fixture whose unsharded run and two-shard plan are prepared')('fixture', () => prepareFixture()),
        When('the shards run, merge, and the budget gate bootstraps its baseline')(
          'outcome',
          (s) => mergeAndBootstrapBudget(s.fixture),
        ),
        Then('the merged budget is the slowest shard against the plan, and the gate writes it as the baseline')(
          (s, expect) =>
            expect({
              mergedBudget: s.outcome.mergedBudget,
              gateExitCode: s.outcome.gate.exitCode,
              baselineSeconds: s.outcome.baselineSeconds,
            }).toEqual({
              mergedBudget: Option.some({ predictedSeconds: 1, actualSeconds: s.outcome.slowestShardSeconds }),
              gateExitCode: 0,
              baselineSeconds: Option.some(s.outcome.slowestShardSeconds),
            }),
        ),
      ),
    )

    scenario(
      'A shard stream written under another schema version is refused by the merge',
      Gherkin.Do.pipe(
        Given('a fixture whose unsharded run and two-shard plan are prepared')('fixture', () => prepareFixture()),
        When('two shards run and one shard stream is rewritten under an older schema version')(
          'outcome',
          (s) => mergeWithDowngradedStream(s.fixture),
        ),
        Then('the merge fails and names both the written and the expected schema versions')((s, expect) =>
          expect({
            exitCode: s.outcome.exitCode === 0 ? 0 : 1,
            namesWrittenVersion: s.outcome.output.includes('6.0'),
            namesExpectedVersion: s.outcome.output.includes('8.0'),
          }).toEqual({ exitCode: 1, namesWrittenVersion: true, namesExpectedVersion: true })
        ),
      ),
    )
  })
