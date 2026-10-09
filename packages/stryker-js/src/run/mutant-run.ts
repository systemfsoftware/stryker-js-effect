import { RunEvent } from '@systemfsoftware/stryker-js-cli-contract'
import { Mutant } from '@systemfsoftware/stryker-js-plugin-interface'
import { Reporter, TestRunner } from '@systemfsoftware/stryker-js-plugin-interface'
import type * as Cause from 'effect/Cause'
import * as Duration from 'effect/Duration'
import * as Effect from 'effect/Effect'
import * as Option from 'effect/Option'
import type * as Path from 'effect/Path'
import * as Pool from 'effect/Pool'
import * as Queue from 'effect/Queue'
import * as Ref from 'effect/Ref'
import * as S from 'effect/Schema'

import { MutantRunObservation } from '../interpret-mutant-run.workflow.js'
import { mutantCostOf, testBodyMsOf } from '../mutant-cost.js'
import { type MutationReportingInput, type MutationReportingService } from '../mutation-reporting.service.js'
import { type PooledTestRunner } from '../pooled-test-runner.handle.js'
import { offerReporterEvent } from '../reporter-stream.service.js'
import { StageError } from '../Run.schema.js'
import type { PooledTestRunnerError } from '../TestRunner.schema.js'
import type { TestBasis } from './dry-run.cell.js'
import { isMutantStatus, toReportedMutant, type ValidMutantStatus } from './mutation-test-plan.js'
import type { RunEnvironmentShape } from './RunEnvironment.service.js'

export interface PreparedStreamableMutant {
  readonly status: ValidMutantStatus
  readonly file: Mutant.CanonicalFileName
  readonly location: Mutant.Location
}

export interface RunContext {
  readonly prev: TestBasis
  readonly env: RunEnvironmentShape
  readonly reporting: MutationReportingService
  readonly progressQueue: Queue.Queue<RunEvent.RunEvent, Cause.Done>
  readonly completedRef: Ref.Ref<number>
  readonly plannedTotal: number
  readonly plannedMutants: readonly Mutant.Mutant[]
  readonly pathService: Path.Path
}

export interface ReportingInputArgs {
  readonly prev: TestBasis
  readonly env: RunEnvironmentShape
  readonly results: readonly Mutant.RunMutantResult[]
}

export const reportingInputOf = (input: ReportingInputArgs): MutationReportingInput => ({
  results: input.results,
  options: input.prev.options,
  project: input.prev.project,
  testCoverage: input.prev.testCoverage,
  timeOverheadMs: Duration.toMillis(input.prev.timeOverhead),
  runId: input.env.runId,
  resolvedMode: input.env.resolvedMode,
  basePath: input.env.basePath,
  reporterStage: input.prev.reporterStage,
  formatRegistry: input.prev.formatRegistry,
  concurrency: input.prev.concurrency.testRunners + input.prev.concurrency.checkers,
  runStartedAt: input.env.runStartedAt,
})

const preparedStreamableOf = Effect.fnUntraced(function*(context: RunContext, result: Mutant.RunMutantResult) {
  return yield* Option.match(Option.filter(Option.some(result.status), isMutantStatus), {
    onNone: () => Effect.succeed(Option.none<PreparedStreamableMutant>()),
    onSome: (status) =>
      Effect.map(
        Effect.orDie(
          S.decodeEffect(Mutant.CanonicalFileName)(
            context.pathService.relative(context.env.basePath, result.fileName),
          ),
        ),
        (file) => Option.some({ status, file, location: result.location }),
      ),
  })
})

const costLineOf = (result: Mutant.RunMutantResult): RunEvent.MutantCost | null =>
  Option.getOrNull(Option.map(Option.fromUndefinedOr(result.cost), (cost) => RunEvent.MutantCost.make(cost)))

const decodeMutantLine = S.decodeUnknownEffect(S.Union([RunEvent.RunMutantIgnored, RunEvent.RunMutantSettled]))

const offerFinished = Effect.fnUntraced(function*(
  context: RunContext,
  result: Mutant.RunMutantResult,
  prepared: Option.Option<PreparedStreamableMutant>,
) {
  return yield* Option.match(prepared, {
    onNone: () => Effect.succeed(Option.none<number>()),
    onSome: (streamable) =>
      Effect.gen(function*() {
        const completed = yield* Ref.updateAndGet(context.completedRef, (n) => n + 1)
        const line = yield* decodeMutantLine({
          _tag: 'mutantTested',
          id: result.id,
          status: streamable.status,
          statusReason: result.statusReason ?? null,
          fileName: streamable.file,
          location: streamable.location,
          mutatorName: result.mutatorName,
          replacement: result.replacement,
          completed,
          total: context.plannedTotal,
          static: result.static ?? false,
          cost: costLineOf(result),
        }).pipe(Effect.orDie)
        yield* Queue.offer(context.progressQueue, line)
        return Option.some(completed)
      }),
  })
})

const reportStreamTested = Effect.fnUntraced(function*(
  context: RunContext,
  result: Mutant.RunMutantResult,
  completed: number,
  prepared: PreparedStreamableMutant,
) {
  yield* offerReporterEvent(
    context.prev.reporterStage,
    Reporter.MutantTested.make({
      id: result.id,
      status: prepared.status,
      fileName: prepared.file,
      location: prepared.location,
      mutatorName: result.mutatorName,
      replacement: result.replacement,
      completed,
      total: context.plannedTotal,
    }),
  ).pipe(
    Effect.tapCause((cause) => Effect.logWarning('Reporter stream failed handling mutantTested', cause)),
    Effect.ignoreCause,
  )
})

const offerStreamTested = Effect.fnUntraced(function*(
  context: RunContext,
  result: Mutant.RunMutantResult,
  completed: Option.Option<number>,
  prepared: Option.Option<PreparedStreamableMutant>,
) {
  yield* Option.match(Option.all([completed, prepared]), {
    onNone: () => Effect.void,
    onSome: ([done, streamable]) => reportStreamTested(context, result, done, streamable),
  })
})

export const announceSettledMutant = Effect.fnUntraced(function*(
  context: RunContext,
  result: Mutant.RunMutantResult,
) {
  const prepared = yield* preparedStreamableOf(context, result)
  const completed = yield* offerFinished(context, result, prepared)
  yield* offerStreamTested(context, result, completed, prepared)
})

const writeCheckpoint = (context: RunContext, results: readonly Mutant.RunMutantResult[]) =>
  context.reporting.checkpoint(
    reportingInputOf({ prev: context.prev, env: context.env, results }),
    context.plannedMutants,
  ).pipe(
    Effect.tapCause((cause) => Effect.logWarning('Failed to persist the mutation checkpoint', cause)),
    Effect.ignoreCause,
  )

const MIN_PAUSE_BETWEEN_CHECKPOINT_WRITES = Duration.seconds(1)

export interface CheckpointWriter {
  readonly record: (result: Mutant.RunMutantResult) => Effect.Effect<void>
}

export const makeCheckpointWriter = Effect.fnUntraced(function*(
  context: RunContext,
  settled: readonly Mutant.RunMutantResult[],
) {
  const completed = yield* Ref.make(settled)
  const written = yield* Ref.make(-1)
  const signals = yield* Queue.sliding<void>(1)
  const writeLatest = Effect.flatMap(
    Ref.get(completed),
    (results) => Effect.andThen(writeCheckpoint(context, results), Ref.set(written, results.length)),
  )
  const writeIfBehind = Effect.flatMap(
    Effect.all([Ref.get(completed), Ref.get(written)]),
    ([results, count]) => Effect.when(writeLatest, Effect.succeed(results.length !== count)),
  )
  yield* writeLatest
  yield* Effect.addFinalizer(() => writeIfBehind)
  yield* Queue.take(signals).pipe(
    Effect.andThen(writeLatest),
    Effect.andThen(Effect.sleep(MIN_PAUSE_BETWEEN_CHECKPOINT_WRITES)),
    Effect.forever,
    Effect.forkScoped,
  )
  return {
    record: (result) =>
      Effect.andThen(Ref.update(completed, (results) => [...results, result]), Queue.offer(signals, undefined)),
  } satisfies CheckpointWriter
})

export interface RunOnePlanArgs {
  readonly context: RunContext
  readonly testRunnerPool: Pool.Pool<PooledTestRunner, StageError | PooledTestRunnerError>
  readonly checkpoint: CheckpointWriter
  readonly plan: Mutant.MutantRunPlan
}

export type MutantRunRaw = typeof MutantRunObservation.Encoded & {
  readonly args: RunOnePlanArgs
  readonly runner: PooledTestRunner
  readonly result: TestRunner.MutantRunResult
  readonly elapsedMs: number
}

const executedTestsCountOf = (executedTests: readonly string[] | undefined): number =>
  Option.match(Option.fromUndefinedOr(executedTests), {
    onNone: () => 0,
    onSome: (ids) => ids.length,
  })

const costOf = (raw: MutantRunRaw): Mutant.MutantCost =>
  mutantCostOf({
    elapsedMs: raw.elapsedMs,
    testBodyMs: testBodyMsOf(raw.result),
    testsExecuted: executedTestsCountOf(raw.executedTests),
    shared: false,
  })

export const settleMutantRun = Effect.fnUntraced(function*(raw: MutantRunRaw) {
  const { context, plan, checkpoint } = raw.args
  const reported = yield* context.reporting.reportMutantRunResult(toReportedMutant(plan.mutant), raw.result)
  const costed: Mutant.RunMutantResult = {
    ...reported,
    cost: costOf(raw),
  }
  const prepared = yield* preparedStreamableOf(context, costed)
  const finished = yield* offerFinished(context, costed, prepared)
  yield* offerStreamTested(context, costed, finished, prepared)
  yield* checkpoint.record(costed)
  return costed
})

export const recycleAndSettleMutantRun = Effect.fnUntraced(function*(raw: MutantRunRaw) {
  yield* Pool.invalidate(raw.args.testRunnerPool, raw.runner)
  return yield* settleMutantRun(raw)
})
