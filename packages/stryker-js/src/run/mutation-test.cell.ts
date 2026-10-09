import { type Cell, Sandwich } from '@systemfsoftware/effect-cell-types'
import { RunEvent, SpanTaxonomy } from '@systemfsoftware/stryker-js-cli-contract'
import { type Mutant, Reporter } from '@systemfsoftware/stryker-js-plugin-interface'
import type { Plugin } from '@systemfsoftware/stryker-js-plugin-interface'
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

import { admitMutationTest, MutationTestError } from '../admit-mutation-test.workflow.js'
import { scoped as checkerPoolsScoped } from '../Checker/checker-pool.blueprint.js'
import {
  type CheckedPlans,
  type CheckerPoolHandle,
  checkPlans,
  checkPlansStream as checkPlansWithConfiguredCheckers,
  inOwnScope,
  makeCheckerPoolHandle,
  programDigestOf,
  runCheckedPlans,
} from '../Checker/checker-pool.handle.js'
import type { CheckerCrash } from '../Checker/Checker.handle.js'
import { checkOnlyCostOf, decidedWithoutATest } from '../mutant-cost.js'
import { MutationReporting } from '../mutation-reporting.service.js'
import { MutationTestCommand } from '../MutationTest.schema.js'
import { offerReporterEvent, type ReporterStage, withPhaseSpan } from '../reporter-stream.service.js'
import { mutantDetailEventsOf, requestedIdsOf, restrictedToRequestedIds } from '../Rerun/rerun-selection.js'
import { RunEvents } from '../run-events.service.js'
import { StageError } from '../Run.schema.js'
import { originalFileFor } from '../Sandbox.handle.js'
import type { PooledTestRunnerError } from '../TestRunner.schema.js'
import { IdGenerator } from '../Worker.service.js'
import { dryRunCell, type DryRunDone } from './dry-run.cell.js'
import { readIncrementalReuse } from './incremental-reuse.cell.js'
import { optionalField } from './incremental-reuse.js'
import { mutantRunCell } from './mutant-run.cell.js'
import { announceSettledMutant, makeCheckpointWriter, reportingInputOf, type RunContext } from './mutant-run.js'
import { draftMutationTestPlan, type MutationTestPlan } from './mutation-test-plan.cell.js'
import {
  configuredTestFilesOf,
  inPlannedOrder,
  isNoCoveragePlan,
  partitionPlannable,
  reportDroppedMutants,
  sandboxFilesOf,
  toReportedMutant,
} from './mutation-test-plan.js'
import { phaseEntered, RunEnvironment } from './RunEnvironment.service.js'
import type { StageServices } from './StageServices.service.js'
import { scoped as testRunnerPoolScoped } from './test-runner-pool.blueprint.js'

const TCE_EQUIVALENT_TO_ORIGINAL_REASON = 'equivalent-to-original: tce'

const TCE_DUPLICATE_AT_SITE_REASON = 'duplicate-at-site: tce'

const countIgnoredByReason = (
  results: readonly Mutant.RunMutantResult[],
  reason: string,
): number => results.filter((result) => result.status === 'Ignored' && result.statusReason === reason).length

const withMeasuredCheckCost = (result: Mutant.RunMutantResult, checkMs: number): Mutant.RunMutantResult =>
  Boolean.match(Boolean.and(result.cost === undefined, decidedWithoutATest(result.status)), {
    onFalse: () => result,
    onTrue: () => ({ ...result, cost: checkOnlyCostOf(checkMs) }),
  })

export interface MutationTestDone {
  readonly results: readonly Mutant.RunMutantResult[]
  readonly verdict: Plugin.ExitClass | null
}

type MutationTestRaw = typeof MutationTestCommand.Encoded & {
  readonly prev: DryRunDone
  readonly plannableMutants: readonly Mutant.Mutant[]
  readonly droppedMutants: readonly Mutant.Mutant[]
}

const writeMutationTestNoTests = Effect.fn(SpanTaxonomy.Spans.mutationTestNoTests.name)(function*() {
  const env = yield* RunEnvironment
  const now = yield* Clock.currentTimeMillis
  const elapsed = Duration.millis(now - env.runStartedAt)
  yield* Effect.logInfo(`Done in ${Duration.format(elapsed)}.`)
  yield* phaseEntered('mutation-test')
  return { results: [], verdict: null }
})

const writeMutationTestDryRunOnly = Effect.fn(SpanTaxonomy.Spans.mutationTestDryRunOnly.name)(function*(
  raw: MutationTestRaw,
) {
  const reporting = yield* MutationReporting
  const env = yield* RunEnvironment
  yield* reporting.publishDryRunCoverage(reportingInputOf({ prev: raw.prev, env, results: [] })).pipe(
    Effect.tapCause((cause) => Effect.logWarning('Failed to publish the dry-run coverage', cause)),
    Effect.ignoreCause,
  )
  yield* phaseEntered('mutation-test')
  yield* Effect.logInfo('The dry-run has been completed successfully. No mutations have been executed.')
  return { results: [], verdict: null }
})

const testRunnerPoolOf = Effect.fnUntraced(function*(prev: DryRunDone, testRunnerCapacity: number) {
  const idGenerator = yield* IdGenerator
  const testFiles = yield* Effect.map(
    sandboxFilesOf({ sandbox: prev.sandbox, fileNames: configuredTestFilesOf(prev) }),
    (pairs) => pairs.map(([, sandboxFileName]) => sandboxFileName),
  )
  return yield* testRunnerPoolScoped({
    options: prev.options,
    fileDescriptions: prev.project.fileDescriptions,
    sandboxWorkingDirectory: prev.sandbox.workingDirectory,
    idGenerator: idGenerator,
    testFiles: testFiles,
    loadedPlugins: prev.loadedPlugins,
    min: prev.concurrency.testRunners,
    max: testRunnerCapacity,
  })
})

const checkedWithoutTests = (
  checkerHandle: Option.Option<CheckerPoolHandle>,
  plan: MutationTestPlan,
): Effect.Effect<Option.Option<CheckedPlans>, StageError | CheckerCrash> =>
  Option.match(Option.filter(checkerHandle, () => plan.earlyResults.length === 0), {
    onNone: () => Effect.succeedNone,
    onSome: (handle) =>
      Effect.map(
        checkPlans(handle, plan.runPlans),
        (checked) => Option.liftPredicate(checked, (candidate: CheckedPlans) => candidate.passedPlans.length === 0),
      ),
  })

const announceMutationTestPlan = Effect.fnUntraced(function*(reporterStage: ReporterStage, plan: MutationTestPlan) {
  yield* offerReporterEvent(
    reporterStage,
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

const proceedPipeline = Effect.fnUntraced(function*(raw: MutationTestRaw) {
  const prev = raw.prev
  const testRunnerCapacity = prev.concurrency.testRunners + prev.concurrency.checkers
  const plannableMutants = raw.plannableMutants
  yield* Effect.when(reportDroppedMutants(raw.droppedMutants), Effect.succeed(Boolean.not(prev.dryRunDeferred)))
  yield* phaseEntered('mutation-test')
  const env = yield* RunEnvironment
  const checkers = yield* inOwnScope(
    checkerPoolsScoped({
      options: prev.options,
      loadedPlugins: prev.loadedPlugins,
      size: prev.concurrency.checkers,
      workingDirectory: env.basePath,
    }),
  )
  const testRunnerPool = yield* Boolean.match(prev.dryRunDeferred, {
    onTrue: () => Effect.succeedNone,
    onFalse: () => Effect.asSome(testRunnerPoolOf(prev, testRunnerCapacity)),
  })
  const reporting = yield* MutationReporting
  const progressQueue = yield* RunEvents
  const checkerHandle = Option.map(Option.fromNullishOr(checkers.resources), makeCheckerPoolHandle)
  const reuse = yield* readIncrementalReuse({
    project: prev.project,
    currentMutants: plannableMutants,
    testCoverage: prev.testCoverage,
    basePath: env.basePath,
    force: prev.options.force,
    options: prev.options,
    globalTestInputs: prev.dryRunResult.globalTestInputs ?? [],
    observedModules: prev.dryRunResult.testFileModules,
    originalFileOf: (file) => originalFileFor(prev.sandbox, file),
    programDigestOf: Option.match(checkerHandle, {
      onNone: () => Effect.as(Effect.void, undefined),
      onSome: (handle) => programDigestOf(handle, env.basePath),
    }),
  })
  const rememberedResults = reuse.rememberedResults
  const plan = yield* draftMutationTestPlan({
    mutants: reuse.mutants,
    testCoverage: prev.testCoverage,
    options: {
      coverageAnalysis: prev.options.coverageAnalysis,
      disableBail: prev.options.disableBail,
      timeoutMS: prev.options.timeoutMS,
      timeoutFactor: prev.options.timeoutFactor,
      ignoreStatic: prev.options.ignoreStatic,
    },
    timeOverheadMS: Duration.toMillis(prev.timeOverhead),
    priorKilledByByMutantId: reuse.priorKilledByByMutantId,
    sandbox: prev.sandbox,
    project: prev.project,
    rememberedCount: rememberedResults.length,
    reporterStage: prev.reporterStage,
  })
  const checkedOnly = yield* Boolean.match(prev.dryRunDeferred, {
    onTrue: () => checkedWithoutTests(checkerHandle, plan),
    onFalse: () => Effect.succeedNone,
  })
  const testsNeeded = Boolean.and(prev.dryRunDeferred, Option.isNone(checkedOnly))
  return yield* Boolean.match(testsNeeded, {
    onTrue: () =>
      Effect.gen(function*() {
        yield* Effect.logInfo('A checker accepted a mutant this run; running the initial test run it needs.')
        yield* checkers.releaseInBackground
        const tested = yield* dryRunCell.run(prev)
        return yield* mutationTestCell.run(tested)
      }),
    onFalse: () =>
      Effect.gen(function*() {
        yield* Effect.when(reportDroppedMutants(raw.droppedMutants), Effect.succeed(prev.dryRunDeferred))
        yield* Queue.offer(
          progressQueue,
          RunEvent.ReuseReported.make({
            reused: rememberedResults.length,
            ran: reuse.mutants.length,
            refused: yield* S.decodeEffect(RunEvent.ReuseRefusals)(reuse.refusalCounts).pipe(Effect.orDie),
          }),
        )
        yield* announceMutationTestPlan(prev.reporterStage, plan)
        const checkedPlans = Option.match(checkedOnly, {
          onNone: () => checkPlansWithConfiguredCheckers(Option.getOrUndefined(checkerHandle), plan.runPlans),
          onSome: (checked) => Stream.succeed(checked),
        })
        const completedRef = yield* Ref.make(0)
        const pathService = yield* Path.Path
        const context: RunContext = {
          prev,
          env,
          reporting,
          progressQueue,
          completedRef,
          plannedTotal: plan.plannedTotal,
          plannedMutants: [...rememberedResults, ...reuse.mutants],
          pathService,
        }
        const settledResults = [
          ...rememberedResults,
          ...plan.earlyResults.map((result) => withMeasuredCheckCost(result, 0)),
        ]
        yield* Effect.forEach(settledResults, (result) => announceSettledMutant(context, result), {
          concurrency: 1,
          discard: true,
        })
        const runResults = yield* Effect.scoped(Effect.gen(function*() {
          const checkpoint = yield* makeCheckpointWriter(context, settledResults)
          const settleReported = (reported: Mutant.RunMutantResult) =>
            Effect.gen(function*() {
              yield* announceSettledMutant(context, reported)
              yield* checkpoint.record(reported)
              return reported
            })
          return yield* withPhaseSpan(
            SpanTaxonomy.Spans.mutationTestBatch,
            { total: plan.plannedTotal, testRunners: prev.concurrency.testRunners },
            () =>
              runCheckedPlans(checkedPlans, {
                settleFailure: (mutantPlan, result, checkMs) =>
                  reporting.reportCheckFailure(toReportedMutant(mutantPlan.mutant), result).pipe(
                    Effect.map((reported) => withMeasuredCheckCost(reported, checkMs)),
                    Effect.flatMap(settleReported),
                  ),
                settleIgnored: (mutantPlan, result) =>
                  reporting.reportIgnored(toReportedMutant(mutantPlan.mutant), result).pipe(
                    Effect.map((reported) => withMeasuredCheckCost(reported, 0)),
                    Effect.flatMap(settleReported),
                  ),
                runPlan: (runPlan, checkMs) =>
                  Option.match(Option.liftPredicate(runPlan, isNoCoveragePlan), {
                    onNone: () =>
                      Option.match(testRunnerPool, {
                        onNone: () =>
                          Effect.die(
                            StageError.make({
                              stage: 'mutationTest',
                              reason: 'A checker-only settlement reached a mutant that needs its tests',
                            }),
                          ),
                        onSome: (pool) =>
                          Effect.scoped(
                            mutantRunCell.run({ context, testRunnerPool: pool, checkpoint, plan: runPlan }),
                          ),
                      }),
                    onSome: (noCoverageRunPlan) =>
                      reporting.reportNoCoverage(toReportedMutant(noCoverageRunPlan.mutant)).pipe(
                        Effect.map((reported) => withMeasuredCheckCost(reported, checkMs)),
                        Effect.flatMap(settleReported),
                      ),
                  }),
                concurrency: testRunnerCapacity,
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
        const checkerRelease = yield* checkers.releaseInBackground
        const allResults = inPlannedOrder({
          planned: context.plannedMutants,
          results: [...settledResults, ...runResults],
        })
        yield* Effect.forEach(
          mutantDetailEventsOf({ requested: requestedIdsOf(prev.options), results: allResults }),
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
        const outcomeResult = yield* reporting.reportAll({
          ...reportingInputOf({ prev, env, results: allResults }),
          closureDigestsByMutantId: reuse.closureDigestsByMutantId,
          timeoutEvidenceByMutantId: reuse.timeoutEvidenceByMutantId,
          ...optionalField('programDigest', reuse.programDigest),
        })
        yield* Fiber.await(checkerRelease)
        const doneNow = yield* Clock.currentTimeMillis
        const elapsed = Duration.millis(doneNow - env.runStartedAt)
        yield* Effect.logInfo(`Done in ${Duration.format(elapsed)}.`)
        return outcomeResult
      }),
  })
})

const mapMutationTestCause = (
  cause: PooledTestRunnerError | PlatformError | StageError,
): StageError =>
  Match.value({ cause }).pipe(
    Match.when({ cause: (candidate: unknown): candidate is StageError => S.is(StageError)(candidate) }, ({ cause }) =>
      cause),
    Match.orElse(({ cause }) =>
      StageError.make({ stage: 'mutationTest', reason: 'Mutation testing failed', cause })
    ),
  )

const writeMutationTestProceed = (raw: MutationTestRaw): Effect.Effect<MutationTestDone, StageError, StageServices> =>
  proceedPipeline(raw).pipe(Effect.mapError(mapMutationTestCause))

const writeMutationTestOutcome = ({
  raw,
  outcome,
}: {
  readonly raw: MutationTestRaw
  readonly outcome: Effect.Effect<MutationTestDone, StageError, StageServices>
}): Effect.Effect<MutationTestDone, StageError, StageServices> =>
  withPhaseSpan(
    SpanTaxonomy.Spans.mutationTestPhase,
    {
      mutantCount: raw.prev.mutants.length,
      skippedMutantCount: raw.droppedMutants.length,
      testCount: raw.prev.dryRunResult.tests.length,
    },
    () => outcome,
  )

export const mutationTestCell: Cell.Cell<DryRunDone, MutationTestDone, StageError, StageServices> = Sandwich.named(
  SpanTaxonomy.Spans.mutationTest.name,
)((command: DryRunDone) =>
  Effect.gen(function*() {
    yield* Scope.Scope
    const prev = command
    const { dropped, plannable } = partitionPlannable(
      restrictedToRequestedIds({ mutants: prev.mutants, requested: requestedIdsOf(prev.options) }),
    )
    const raw: MutationTestRaw = {
      _tag: 'MutationTestCommand',
      dryRunOnly: prev.options.dryRunOnly,
      allowEmpty: prev.options.allowEmpty,
      testCount: prev.dryRunResult.tests.length,
      isZero: Boolean.and(Boolean.not(prev.dryRunDeferred), prev.dryRunResult.tests.length === 0),
      prev,
      plannableMutants: plannable,
      droppedMutants: dropped,
    }
    return raw
  })
).decide(admitMutationTest).write({
  MutationTestDryRunOnly: (_decision, raw) =>
    writeMutationTestOutcome({ raw, outcome: writeMutationTestDryRunOnly(raw) }),
  MutationTestNoTests: (_decision, raw) => writeMutationTestOutcome({ raw, outcome: writeMutationTestNoTests() }),
  MutationTestProceed: (_decision, raw) => writeMutationTestOutcome({ raw, outcome: writeMutationTestProceed(raw) }),
  MutationTestError: ({ stage, reason }) =>
    Effect.fail(StageError.make({ stage, reason, cause: MutationTestError.make({ stage, reason }) })),
  CommandRejected: ({ issue }) => Effect.fail(StageError.make({ stage: 'mutationTest', reason: issue })),
})
