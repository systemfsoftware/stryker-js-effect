import { Sandwich } from '@systemfsoftware/effect-cell-types'
import { Mutant } from '@systemfsoftware/stryker-js-instrumenter'
import { Reporter, TestRunner } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Cause from 'effect/Cause'
import * as Effect from 'effect/Effect'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Path from 'effect/Path'
import * as Pool from 'effect/Pool'
import * as Queue from 'effect/Queue'
import * as Ref from 'effect/Ref'
import * as S from 'effect/Schema'
import type * as Scope from 'effect/Scope'
import type * as Semaphore from 'effect/Semaphore'

import { interpretMutantRun, MutantRunObservation } from '../interpret-mutant-run.workflow.js'
import { type MutationReportingInput, type MutationReportingService } from '../mutation-reporting.service.js'
import { invalidatesRunnerPool, type PooledTestRunner } from '../pooled-test-runner.handle.js'
import { offerReporterEvent } from '../reporter-stream.service.js'
import { ReportFileName } from '../reporting/report-assembly.schema.js'
import type { RunEvent } from '../run-event.schema.js'
import { RunMutantTested } from '../run-events.service.js'
import { StageError } from '../Run.schema.js'
import type { PooledTestRunnerError } from '../TestRunner.schema.js'
import type { DryRunDone } from './dry-run.cell.js'
import { isMutantStatus, toReportedMutant, type ValidMutantStatus } from './mutation-test-plan.cell.js'
import type { RunEnvironmentShape } from './RunEnvironment.service.js'

export interface PreparedStreamableMutant {
  readonly status: ValidMutantStatus
  readonly file: string
  readonly location: Mutant.Location
}

export interface RunContext {
  readonly prev: DryRunDone
  readonly env: RunEnvironmentShape
  readonly reporting: MutationReportingService
  readonly progressQueue: Queue.Queue<RunEvent, Cause.Done>
  readonly completedRef: Ref.Ref<number>
  readonly plannedTotal: number
  readonly pathService: Path.Path
}

export interface ReportingInputArgs {
  readonly prev: DryRunDone
  readonly env: RunEnvironmentShape
  readonly results: readonly Mutant.RunMutantResult[]
}

export const reportingInputOf = (input: ReportingInputArgs): MutationReportingInput => ({
  results: input.results,
  options: input.prev.options,
  project: input.prev.project,
  testCoverage: input.prev.testCoverage,
  runId: input.env.runId,
  resolvedMode: input.env.resolvedMode,
  basePath: input.env.basePath,
  reporterStage: input.prev.reporterStage,
  formatRegistry: input.prev.formatRegistry,
})

export const reasonOf = (result: { readonly status: string; readonly reason?: string }): string | undefined =>
  Match.value(result).pipe(
    Match.when({ status: 'timeout' }, (timedOut) => timedOut.reason),
    Match.orElse(() => undefined),
  )

const invalidateSlot = <A, E, I>(
  pool: Pool.Pool<A, I>,
  slot: A,
  error: E,
): Effect.Effect<never, E> => Effect.flatMap(Pool.invalidate(pool, slot), () => Effect.fail(error))

const preparedStreamableOf = Effect.fnUntraced(function*(context: RunContext, result: Mutant.RunMutantResult) {
  return yield* Option.match(Option.filter(Option.some(result.status), isMutantStatus), {
    onNone: () => Effect.succeed(Option.none<PreparedStreamableMutant>()),
    onSome: (status) =>
      Effect.map(
        Effect.all([
          Effect.orDie(S.decodeEffect(Mutant.ReportLocationFromMutant)(result.location)),
          Effect.orDie(
            S.decodeEffect(ReportFileName)(context.pathService.relative(context.env.basePath, result.fileName)),
          ),
        ]),
        ([location, file]) => Option.some({ status, file, location }),
      ),
  })
})

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
        yield* Queue.offer(
          context.progressQueue,
          RunMutantTested.make({
            id: result.id,
            status: streamable.status,
            file: streamable.file,
            location: streamable.location,
            mutator: result.mutatorName,
            replacement: result.replacement,
            completed,
            total: context.plannedTotal,
          }),
        )
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
      file: prepared.file,
      location: prepared.location,
      mutator: result.mutatorName,
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

export const checkpointMutationResults = Effect.fnUntraced(function*(
  context: RunContext,
  completedMutants: Ref.Ref<readonly Mutant.RunMutantResult[]>,
) {
  const input = yield* Ref.get(completedMutants)
  yield* context.reporting.checkpoint(reportingInputOf({ prev: context.prev, env: context.env, results: input })).pipe(
    Effect.tapCause((cause) => Effect.logWarning('Failed to persist the mutation checkpoint', cause)),
    Effect.ignoreCause,
  )
})

const persist = Effect.fnUntraced(function*(
  context: RunContext,
  completedMutants: Ref.Ref<readonly Mutant.RunMutantResult[]>,
  result: Mutant.RunMutantResult,
) {
  yield* Ref.update(completedMutants, (completed) => [...completed, result])
  yield* checkpointMutationResults(context, completedMutants)
})

export interface RunOnePlanArgs {
  readonly context: RunContext
  readonly testRunnerPool: Pool.Pool<PooledTestRunner, StageError | PooledTestRunnerError>
  readonly checkpointGate: Semaphore.Semaphore
  readonly completedMutants: Ref.Ref<readonly Mutant.RunMutantResult[]>
  readonly plan: Mutant.MutantRunPlan
}

type MutantRunRaw = typeof MutantRunObservation.Encoded & {
  readonly args: RunOnePlanArgs
  readonly runner: PooledTestRunner
  readonly result: TestRunner.MutantRunResult
}

const readMutantRun = Effect.fnUntraced(function*(input: RunOnePlanArgs) {
  const { testRunnerPool, plan } = input
  const runner = yield* Pool.get(testRunnerPool)
  const result = yield* runner.mutantRun(plan.runOptions).pipe(
    Effect.withSpan('stryker.testRunner.mutantRun', {
      attributes: {
        'stryker.mutant.id': plan.mutant.id,
        'stryker.mutant.mutator': plan.mutant.mutatorName,
        'stryker.mutant.file': plan.mutant.fileName,
      },
    }),
    Effect.tap((runResult) =>
      Effect.annotateCurrentSpan({
        'stryker.mutant.status': runResult.status,
      })
    ),
    Effect.catchTags({
      OutOfMemoryError: (error) => invalidateSlot(testRunnerPool, runner, error),
      ChildProcessCrashedError: (error) => invalidateSlot(testRunnerPool, runner, error),
    }),
  )
  return {
    wallClockTimeout: invalidatesRunnerPool(result.status, reasonOf(result)),
    args: input,
    runner,
    result,
  }
})

const settleMutantRun = Effect.fnUntraced(function*(raw: MutantRunRaw) {
  const { context, plan, checkpointGate, completedMutants } = raw.args
  const reported = yield* context.reporting.reportMutantRunResult(toReportedMutant(plan.mutant), raw.result)
  const prepared = yield* preparedStreamableOf(context, reported)
  const finished = yield* offerFinished(context, reported, prepared)
  yield* offerStreamTested(context, reported, finished, prepared)
  yield* checkpointGate.withPermits(1)(persist(context, completedMutants, reported))
  return reported
})

const recycleAndSettleMutantRun = Effect.fnUntraced(function*(raw: MutantRunRaw) {
  yield* Pool.invalidate(raw.args.testRunnerPool, raw.runner)
  return yield* settleMutantRun(raw)
})

const mutantRunCell = Sandwich.named('stryker.mutant_run')(readMutantRun)
  .decide(interpretMutantRun)
  .write({
    MutantRunSettled: (_decision, raw) => settleMutantRun(raw),
    MutantRunPoolInvalidated: (_decision, raw) => recycleAndSettleMutantRun(raw),
    CommandRejected: ({ issue }) =>
      Effect.fail(StageError.make({ stage: 'mutationTest', reason: `mutant run command rejected: ${issue}` })),
  })

export const runOnePlan: (
  input: RunOnePlanArgs,
) => Effect.Effect<Mutant.RunMutantResult, StageError | PooledTestRunnerError, Scope.Scope> = (input) =>
  mutantRunCell.run(input)
