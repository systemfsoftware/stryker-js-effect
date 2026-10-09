import { RunEvent, SpanTaxonomy } from '@systemfsoftware/stryker-js-cli-contract'
import { type Mutant, Reporter } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Boolean from 'effect/Boolean'
import * as Clock from 'effect/Clock'
import * as Duration from 'effect/Duration'
import * as Effect from 'effect/Effect'
import * as Fiber from 'effect/Fiber'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Path from 'effect/Path'
import type { PlatformError } from 'effect/PlatformError'
import * as Queue from 'effect/Queue'
import * as Ref from 'effect/Ref'
import * as S from 'effect/Schema'
import * as Scope from 'effect/Scope'
import * as Stream from 'effect/Stream'

import { scoped as checkerPoolsScoped } from '../Checker/checker-pool.blueprint.js'
import {
  type CheckedPlans,
  checkerConfigDigestOf,
  type CheckerPoolHandle,
  inOwnScope,
  makeCheckerPoolHandle,
  NO_CHECKER_CONFIG_DIGEST,
  programDigestOf,
  runCheckedPlans,
} from '../Checker/checker-pool.handle.js'
import type { CheckerCrash } from '../Checker/Checker.handle.js'
import { checkOnlyCostOf, decidedWithoutATest } from '../mutant-cost.js'
import { MutationReporting } from '../mutation-reporting.service.js'
import { offerReporterEvent, withPhaseSpan } from '../reporter-stream.service.js'
import { mutantDetailEventsOf, requestedIdsOf } from '../Rerun/rerun-selection.js'
import { RunEvents } from '../run-events.service.js'
import { StageError } from '../Run.schema.js'
import { originalFileFor } from '../Sandbox.handle.js'
import type { PooledTestRunnerError } from '../TestRunner.schema.js'
import type { TestBasis } from './dry-run.cell.js'
import { type IncrementalReuse, readIncrementalReuse } from './incremental-reuse.cell.js'
import {
  announceSettledMutant,
  type CheckpointWriter,
  makeCheckpointWriter,
  reportingInputOf,
  type RunContext,
} from './mutant-run.js'
import { draftMutationTestPlan, type MutationTestPlan } from './mutation-test-plan.cell.js'
import { inPlannedOrder, toReportedMutant } from './mutation-test-plan.js'
import { RunEnvironment } from './RunEnvironment.service.js'
import type { StageServices } from './StageServices.service.js'
import { putSettledVerdict } from './verdict-put.js'

const TCE_EQUIVALENT_TO_ORIGINAL_REASON = 'equivalent-to-original: tce'

const TCE_DUPLICATE_AT_SITE_REASON = 'duplicate-at-site: tce'

const countIgnoredByReason = (
  results: readonly Mutant.RunMutantResult[],
  reason: string,
): number => results.filter((result) => result.status === 'Ignored' && result.statusReason === reason).length

export const asMutationTestError = (cause: PooledTestRunnerError | PlatformError | StageError): StageError =>
  Match.value({ cause }).pipe(
    Match.when(
      { cause: (candidate: unknown): candidate is StageError => S.is(StageError)(candidate) },
      ({ cause }) => cause,
    ),
    Match.orElse(({ cause }) => StageError.make({ stage: 'mutationTest', reason: 'Mutation testing failed', cause })),
  )

const withMeasuredCheckCost = (result: Mutant.RunMutantResult, checkMs: number): Mutant.RunMutantResult =>
  Boolean.match(Boolean.and(result.cost === undefined, decidedWithoutATest(result.status)), {
    onFalse: () => result,
    onTrue: () => ({ ...result, cost: checkOnlyCostOf(checkMs) }),
  })

export interface Checkers {
  readonly releaseInBackground: Effect.Effect<Fiber.Fiber<void>, never, Scope.Scope>
  readonly handle: Option.Option<CheckerPoolHandle>
}

export const acquireCheckers = (basis: TestBasis): Effect.Effect<Checkers, never, StageServices | Scope.Scope> =>
  Effect.gen(function*() {
    const env = yield* RunEnvironment
    const checkers = yield* inOwnScope(
      checkerPoolsScoped({
        options: basis.options,
        loadedPlugins: basis.loadedPlugins,
        size: basis.concurrency.checkers,
        workingDirectory: env.basePath,
      }),
    )
    return {
      releaseInBackground: checkers.releaseInBackground,
      handle: Option.map(Option.fromNullishOr(checkers.resources), makeCheckerPoolHandle),
    }
  })

export interface ReuseAndPlanInput {
  readonly basis: TestBasis
  readonly checkerHandle: Option.Option<CheckerPoolHandle>
  readonly plannableMutants: readonly Mutant.Mutant[]
  readonly globalTestInputs: readonly string[]
  readonly observedModules: Readonly<Record<string, readonly string[]>> | undefined
}

export const reuseAndPlan = Effect.fnUntraced(function*(input: ReuseAndPlanInput) {
  const env = yield* RunEnvironment
  const basis = input.basis
  const reuse = yield* readIncrementalReuse({
    project: basis.project,
    currentMutants: input.plannableMutants,
    testCoverage: basis.testCoverage,
    basePath: env.basePath,
    force: basis.options.force,
    options: basis.options,
    globalTestInputs: input.globalTestInputs,
    observedModules: input.observedModules,
    originalFileOf: (file) => originalFileFor(basis.sandbox, file),
    fileContentDigests: basis.fileContentDigests,
    store: basis.verdictStore,
    checkerConfigDigestOf: Option.match(input.checkerHandle, {
      onNone: () => Effect.succeed(NO_CHECKER_CONFIG_DIGEST),
      onSome: (handle) => checkerConfigDigestOf(handle, env.basePath),
    }),
    programDigestOf: Option.match(input.checkerHandle, {
      onNone: () => Effect.as(Effect.void, undefined),
      onSome: (handle) => programDigestOf(handle, env.basePath),
    }),
  })
  const plan = yield* draftMutationTestPlan({
    mutants: reuse.mutants,
    testCoverage: basis.testCoverage,
    options: {
      coverageAnalysis: basis.options.coverageAnalysis,
      disableBail: basis.options.disableBail,
      timeoutMS: basis.options.timeoutMS,
      timeoutFactor: basis.options.timeoutFactor,
      ignoreStatic: basis.options.ignoreStatic,
    },
    timeOverheadMS: Duration.toMillis(basis.timeOverhead),
    priorKilledByByMutantId: reuse.priorKilledByByMutantId,
    sandbox: basis.sandbox,
    project: basis.project,
    rememberedCount: reuse.rememberedResults.length,
    reporterStage: basis.reporterStage,
  })
  return { reuse, plan }
})

const announceMutationTestPlan = Effect.fnUntraced(function*(basis: TestBasis, plan: MutationTestPlan) {
  yield* offerReporterEvent(
    basis.reporterStage,
    Reporter.MutationTestingPlanReady.make({
      total: plan.plannedTotal,
      plans: plan.plansForReporter.map((runPlan) => ({
        mutantId: runPlan.mutant.id,
        plan: runPlan.plan,
        netTime: runPlan.netTime,
        reloadEnvironment: runPlan.runOptions.reloadEnvironment,
      })),
    }),
  ).pipe(Effect.ignoreCause)
  yield* Queue.offer(
    yield* RunEvents,
    RunEvent.PlanKnown.make({ total: plan.plansForReporter.length + plan.earlyResults.length, shardPlan: null }),
  )
})

export interface Settlement<Passed extends Mutant.MutantRunPlan, E> {
  readonly basis: TestBasis
  readonly checkers: Checkers
  readonly reuse: IncrementalReuse
  readonly plan: MutationTestPlan
  readonly checkedPlans: Stream.Stream<CheckedPlans<Passed>, StageError | CheckerCrash>
  readonly runPlanOf: (
    settling: PlanSettling,
  ) => (plan: Passed, checkMs: number) => Effect.Effect<Mutant.RunMutantResult, E>
}

export interface PlanSettling {
  readonly context: RunContext
  readonly checkpoint: CheckpointWriter
  readonly settleChecked: (reported: Mutant.RunMutantResult, checkMs: number) => Effect.Effect<Mutant.RunMutantResult>
}

const warnOfStoreGaps = (unreadMutants: number, skippedPuts: number): Effect.Effect<void> =>
  Effect.when(
    Effect.logWarning(
      `The verdict store could not be read for ${unreadMutants} mutants and did not store ${skippedPuts} verdicts; those mutants are tested again next run.`,
    ),
    Effect.succeed(unreadMutants + skippedPuts > 0),
  ).pipe(Effect.asVoid)

export const settleMutants = Effect.fnUntraced(function*<Passed extends Mutant.MutantRunPlan, E>(
  settlement: Settlement<Passed, E>,
) {
  const { basis, reuse, plan } = settlement
  const env = yield* RunEnvironment
  const reporting = yield* MutationReporting
  const progressQueue = yield* RunEvents
  const rememberedResults = reuse.rememberedResults
  yield* Queue.offer(
    progressQueue,
    RunEvent.ReuseReported.make({
      reused: rememberedResults.length,
      ran: reuse.mutants.length,
      refused: yield* S.decodeEffect(RunEvent.ReuseRefusals)(reuse.refusalCounts).pipe(Effect.orDie),
    }),
  )
  yield* announceMutationTestPlan(basis, plan)
  const plannedMutants = [...rememberedResults, ...reuse.mutants]
  const skippedPuts = yield* Ref.make(0)
  const context: RunContext = {
    prev: basis,
    env,
    reporting,
    progressQueue,
    completedRef: yield* Ref.make(0),
    plannedTotal: plan.plannedTotal,
    putVerdict: putSettledVerdict({ store: basis.verdictStore, reuse, skippedPuts }),
    pathService: yield* Path.Path,
  }
  const earlyResults = plan.earlyResults.map((result) => withMeasuredCheckCost(result, 0))
  const settledResults = [...rememberedResults, ...earlyResults]
  yield* Effect.forEach(settledResults, (result) => announceSettledMutant(context, result), {
    concurrency: 1,
    discard: true,
  })
  yield* Effect.forEach(earlyResults, context.putVerdict, { discard: true })
  const capacity = basis.concurrency.testRunners + basis.concurrency.checkers
  const runResults = yield* Effect.scoped(Effect.gen(function*() {
    const checkpoint = yield* makeCheckpointWriter(context, settledResults)
    const settleChecked = (reported: Mutant.RunMutantResult, checkMs: number) =>
      Effect.gen(function*() {
        const measured = withMeasuredCheckCost(reported, checkMs)
        yield* announceSettledMutant(context, measured)
        yield* checkpoint.record(measured)
        return measured
      })
    return yield* withPhaseSpan(
      SpanTaxonomy.Spans.mutationTestBatch,
      { total: plan.plannedTotal, testRunners: basis.concurrency.testRunners },
      () =>
        runCheckedPlans(settlement.checkedPlans, {
          settleFailure: (mutantPlan, result, checkMs) =>
            Effect.flatMap(
              reporting.reportCheckFailure(toReportedMutant(mutantPlan.mutant), result),
              (reported) => settleChecked(reported, checkMs),
            ),
          settleIgnored: (mutantPlan, result) =>
            Effect.flatMap(
              reporting.reportIgnored(toReportedMutant(mutantPlan.mutant), result),
              (reported) => settleChecked(reported, 0),
            ),
          runPlan: settlement.runPlanOf({ context, checkpoint, settleChecked }),
          concurrency: capacity,
        }).pipe(
          Stream.runFold(
            (): Mutant.RunMutantResult[] => [],
            (acc, result) => {
              acc.push(result)
              return acc
            },
          ),
        ),
    )
  }))
  const checkerRelease = yield* settlement.checkers.releaseInBackground
  const allResults = inPlannedOrder({
    planned: plannedMutants,
    results: [...settledResults, ...runResults],
  })
  yield* Effect.forEach(
    mutantDetailEventsOf({ requested: requestedIdsOf(basis.options), results: allResults }),
    (detail) => Queue.offer(progressQueue, detail),
    { discard: true },
  )
  yield* Queue.offer(
    progressQueue,
    RunEvent.TceReported.make({
      equivalentToOriginal: countIgnoredByReason(allResults, TCE_EQUIVALENT_TO_ORIGINAL_REASON),
      duplicateAtSite: countIgnoredByReason(allResults, TCE_DUPLICATE_AT_SITE_REASON),
    }),
  )
  const outcomeResult = yield* reporting.reportAll(reportingInputOf({ prev: basis, env, results: allResults }))
  yield* warnOfStoreGaps(reuse.refusalCounts.storeUnavailable, yield* Ref.get(skippedPuts))
  yield* Fiber.await(checkerRelease)
  const doneNow = yield* Clock.currentTimeMillis
  yield* Effect.logInfo(`Done in ${Duration.format(Duration.millis(doneNow - env.runStartedAt))}.`)
  return outcomeResult
})
