import { NodeFileSystem, NodePath } from '@effect/platform-node'
import { Gherkin, Given, it, makeFeature, Then } from '@systemfsoftware/effect-gherkin-spec'
import { Cli } from '@systemfsoftware/stryker-js'
import { RunEvent } from '@systemfsoftware/stryker-js-cli-contract'
import type { Run } from '@systemfsoftware/stryker-js-contracts'
import { Incremental } from '@systemfsoftware/stryker-js-contracts'
import { Engine } from '@systemfsoftware/stryker-js-engine'
import { type Options } from '@systemfsoftware/stryker-js-plugin-interface'
import { mergeConfig } from '@systemfsoftware/stryker-js/config'
import type * as Cause from 'effect/Cause'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as Layer from 'effect/Layer'
import * as Option from 'effect/Option'
import * as Path from 'effect/Path'
import * as Queue from 'effect/Queue'
import * as S from 'effect/Schema'

const Feature = makeFeature({ it })

const filePorts = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer)

const SOURCE = [
  'export const add = (left: number, right: number): number => left + right',
  'export const label = (): string => "value"',
  '',
].join('\n')

const environmentFor = (directory: string): Run.RunEnvironmentShape => ({
  runId: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
  resolvedMode: { mode: 'machine', signal: 'flag', stdoutIsTTY: false },
  runStartedAt: 0,
  basePath: directory,
  builtinReporters: {},
  configOverlay: mergeConfig,
  allowConsoleColors: false,
})

const writeFixture = (
  files: ReadonlyArray<readonly [string, string]>,
): Effect.Effect<string, never, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const root = yield* fs.makeTempDirectory()
    yield* Effect.forEach(
      files,
      ([file, content]) =>
        Effect.gen(function*() {
          const target = path.join(root, file)
          yield* fs.makeDirectory(path.dirname(target), { recursive: true })
          yield* fs.writeFileString(target, content)
        }),
      { discard: true },
    )
    return root
  }).pipe(Effect.orDie)

const removeFixture = (root: string): Effect.Effect<void, never, never> =>
  Effect.provide(
    Effect.orDie(Effect.flatMap(FileSystem.FileSystem, (fs) => fs.remove(root, { recursive: true, force: true }))),
    filePorts,
  )

const optionsOf = (root: string): Options.PartialStrykerOptions => ({
  testRunner: 'command',
  commandRunner: { command: 'true' },
  coverageAnalysis: 'off',
  reporters: [],
  mutate: ['src/**/*.ts'],
  checkers: [],
  cleanTempDir: 'always',
  incremental: true,
  incrementalFile: `${root}/reports/main.json`,
})

interface MutantCost {
  readonly predictedMs: number
  readonly actualMs: number | null
  readonly coveringTests: number
}

interface ReportRead {
  readonly costs: Readonly<Record<string, MutantCost>>
  readonly statuses: Readonly<Record<string, string>>
}

const readReport = (text: string): ReportRead =>
  Option.match(S.decodeOption(S.fromJsonString(Incremental.IncrementalReportSchema))(text), {
    onNone: () => ({ costs: {}, statuses: {} }),
    onSome: (report) => {
      const mutants = Object.values(report.files).flatMap((file) => file.mutants)
      return {
        costs: report.costs,
        statuses: Object.fromEntries(mutants.map((mutant) => [mutant.id, mutant.status])),
      }
    },
  })

const runOnce = (root: string): Effect.Effect<
  { readonly text: string; readonly reused: number; readonly streamCosts: Readonly<Record<string, number>> },
  never,
  never
> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const queue = yield* Queue.bounded<RunEvent.RunEvent, Cause.Done>(RunEvent.RunEvent.QUEUE_BOUND)
    const ports = Cli.platformLayer
    const runLayer = Layer.merge(Layer.provide(Engine.stage(environmentFor(root), queue), ports), ports)
    yield* Engine.mutationTestCell
      .run({ cliOptions: optionsOf(root), targetMutatePatterns: undefined })
      .pipe(Effect.provide(runLayer), Effect.scoped, Effect.orDie)
    const events = yield* Queue.end(queue).pipe(
      Effect.andThen(Queue.takeAll(queue)),
      Effect.orElseSucceed((): ReadonlyArray<RunEvent.RunEvent> => []),
    )
    const reused = events.flatMap((event) => S.is(RunEvent.ReuseReported)(event) ? [event.reused] : []).reduce(
      (total, count) => total + count,
      0,
    )
    const streamCosts = Object.fromEntries(
      events.flatMap((event) =>
        S.is(RunEvent.RunMutantTested)(event) && event.cost !== null
          ? [[event.id, event.cost.fixedOverheadMs + event.cost.testBodyMs] as const]
          : []
      ),
    )
    const text = yield* fs.readFileString(path.join(root, 'reports', 'main.json')).pipe(
      Effect.orElseSucceed(() => ''),
    )
    return { text, reused, streamCosts }
  }).pipe(Effect.orDie, Effect.provide(filePorts))

const EXECUTED_STATUSES: Record<string, true> = { Killed: true, Survived: true, Timeout: true }

interface FirstRead extends ReportRead {
  readonly streamCosts: Readonly<Record<string, number>>
}

interface Observed {
  readonly first: FirstRead
  readonly second: ReportRead
  readonly reused: number
}

const costSummaryOf = (observed: Observed) => {
  const firstIds = Object.keys(observed.first.costs)
  const secondIds = Object.keys(observed.second.costs)
  const costs = observed.first.costs
  const executedIds = firstIds.filter((id) => EXECUTED_STATUSES[observed.first.statuses[id] ?? ''] === true)
  return {
    firstHasCosts: firstIds.length > 0,
    firstCoversEveryMutant: Object.keys(observed.first.statuses).every((id) => costs[id] !== undefined),
    executedHaveActualMs: executedIds.length > 0 && executedIds.every((id) => costs[id]?.actualMs !== null),
    secondCoversEveryMutant: secondIds.every((id) => observed.second.costs[id] !== undefined),
    secondReusedSome: observed.reused > 0,
    carriedForward: secondIds.every((id) => observed.second.costs[id]?.actualMs === costs[id]?.actualMs),
    streamMatchesRecord: executedIds.length > 0 &&
      executedIds.every((id) => observed.first.streamCosts[id] === costs[id]?.actualMs),
    predictionsAreNonNegative: Object.values(costs).every((cost) => cost.predictedMs >= 0 && cost.coveringTests >= 0),
  }
}

Feature('Per-mutant cost record')
  .withLayer(Layer.empty)
  .live('the scenarios drive the real engine over the host filesystem, so report I/O is the real one')
  .body(({ scenario }) => {
    scenario(
      'A run records costs for every mutant and carries actualMs forward when it reuses verdicts',
      Gherkin.Do.pipe(
        Given('a workspace whose incremental run completes twice')('observed', () =>
          Effect.gen(function*() {
            const root = yield* writeFixture([['src/math.ts', SOURCE]])
            return yield* Effect.ensuring(
              Effect.gen(function*() {
                const first = yield* runOnce(root)
                const second = yield* runOnce(root)
                return {
                  first: { ...readReport(first.text), streamCosts: first.streamCosts },
                  second: readReport(second.text),
                  reused: second.reused,
                }
              }),
              removeFixture(root),
            )
          }).pipe(Effect.orDie, Effect.provide(filePorts))),
        Then(
          'the written report decodes with a cost for every mutant, an actualMs on each executed mutant, and the reused run carries the prior actualMs',
        )(
          (s, expect) =>
            expect(costSummaryOf(s.observed)).toEqual({
              firstHasCosts: true,
              firstCoversEveryMutant: true,
              executedHaveActualMs: true,
              secondCoversEveryMutant: true,
              secondReusedSome: true,
              carriedForward: true,
              streamMatchesRecord: true,
              predictionsAreNonNegative: true,
            }),
        ),
      ),
    )
  })
