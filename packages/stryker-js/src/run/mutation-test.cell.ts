import { Sandwich } from '@systemfsoftware/effect-cell-types'
import type { Mutant } from '@systemfsoftware/stryker-js-instrumenter'
import type { Plugin } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Clock from 'effect/Clock'
import * as Duration from 'effect/Duration'
import * as Effect from 'effect/Effect'
import * as Fiber from 'effect/Fiber'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Path from 'effect/Path'
import type { PlatformError } from 'effect/PlatformError'
import * as Ref from 'effect/Ref'
import * as S from 'effect/Schema'
import * as Scope from 'effect/Scope'
import * as Semaphore from 'effect/Semaphore'
import * as Stream from 'effect/Stream'

import { admitMutationTest, MutationTestError } from '../admit-mutation-test.workflow.js'
import { scoped as checkerPoolsScoped } from '../Checker/checker-pool.blueprint.js'
import {
  checkPlans as checkPlansWithConfiguredCheckers,
  inOwnScope,
  makeCheckerPoolHandle,
} from '../Checker/checker-pool.handle.js'
import { MutationReporting } from '../mutation-reporting.service.js'
import { MutationTestCommand } from '../MutationTest.schema.js'
import { withPhaseSpan } from '../reporter-stream.service.js'
import { RunEvents } from '../run-events.service.js'
import { StageError } from '../Run.schema.js'
import type { PooledTestRunnerError } from '../TestRunner.schema.js'
import { IdGenerator } from '../Worker.service.js'
import type { DryRunDone } from './dry-run.cell.js'
import { readIncrementalReuse } from './incremental-reuse.cell.js'
import {
  announceSettledMutant,
  checkpointMutationResults,
  emptyRunResults,
  reportingInputOf,
  type RunContext,
  runOnePlan,
} from './mutant-run.cell.js'
import {
  configuredTestFilesOf,
  partitionPlannable,
  planMutationTest,
  reportDroppedMutants,
  sandboxFilesOf,
  toReportedMutant,
} from './mutation-test-plan.cell.js'
import { phaseEntered, RunEnvironment } from './RunEnvironment.service.js'
import type { StageServices } from './StageServices.service.js'
import { scoped as testRunnerPoolScoped } from './test-runner-pool.blueprint.js'

export interface MutationTestDone {
  readonly results: readonly Mutant.RunMutantResult[]
  readonly verdict: Plugin.ExitClass | null
}

type MutationTestRaw = typeof MutationTestCommand.Encoded & {
  readonly prev: DryRunDone
}

const writeMutationTestNoTests = Effect.fn('stryker.mutation_test.no_tests')(function*() {
  const env = yield* RunEnvironment
  const now = yield* Clock.currentTimeMillis
  const elapsed = Duration.millis(now - env.runStartedAt)
  yield* Effect.logInfo(`Done in ${Duration.format(elapsed)}.`)
  yield* phaseEntered('mutation-test')
  return { results: [], verdict: null }
})

const writeMutationTestDryRunOnly = Effect.fn('stryker.mutation_test.dry_run_only')(function*() {
  yield* phaseEntered('mutation-test')
  yield* Effect.logInfo('The dry-run has been completed successfully. No mutations have been executed.')
  return { results: [], verdict: null }
})

const proceedPipeline = Effect.fnUntraced(function*(raw: MutationTestRaw) {
  const prev = raw.prev
  const testRunnerCapacity = prev.concurrency.testRunners + prev.concurrency.checkers
  const { dropped, plannable: plannableMutants } = partitionPlannable(prev.mutants)
  yield* reportDroppedMutants(dropped)
  yield* phaseEntered('mutation-test')
  const idGenerator = yield* IdGenerator
  const env = yield* RunEnvironment
  const checkers = yield* inOwnScope(
    checkerPoolsScoped({
      options: prev.options,
      loadedPlugins: prev.loadedPlugins,
      size: prev.concurrency.checkers,
      workingDirectory: env.basePath,
    }),
  )
  const testFiles = yield* Effect.map(
    sandboxFilesOf({ sandbox: prev.sandbox, fileNames: configuredTestFilesOf(prev) }),
    (pairs) => pairs.map(([, sandboxFileName]) => sandboxFileName),
  )
  const testRunnerPool = yield* testRunnerPoolScoped({
    options: prev.options,
    fileDescriptions: prev.project.fileDescriptions,
    sandboxWorkingDirectory: prev.sandbox.workingDirectory,
    idGenerator: idGenerator,
    testFiles: testFiles,
    loadedPlugins: prev.loadedPlugins,
    min: prev.concurrency.testRunners,
    max: testRunnerCapacity,
  })
  const reporting = yield* MutationReporting
  const reuse = yield* readIncrementalReuse({
    project: prev.project,
    currentMutants: plannableMutants,
    testCoverage: prev.testCoverage,
    basePath: env.basePath,
    force: prev.options.force,
    formatRegistry: prev.formatRegistry,
  })
  const rememberedResults = reuse.rememberedResults
  yield* Effect.when(
    Effect.logInfo(
      `Incremental mode: reusing ${rememberedResults.length} mutant result(s), running ${reuse.mutants.length} mutant(s).`,
    ),
    Effect.succeed(rememberedResults.length > 0),
  )
  const plan = yield* planMutationTest({
    mutants: reuse.mutants,
    testCoverage: prev.testCoverage,
    options: {
      disableBail: prev.options.disableBail,
      timeoutMS: prev.options.timeoutMS,
      timeoutFactor: prev.options.timeoutFactor,
      ignoreStatic: prev.options.ignoreStatic,
    },
    timeOverheadMS: Duration.toMillis(prev.timeOverhead),
    sandbox: prev.sandbox,
    project: prev.project,
    rememberedCount: rememberedResults.length,
    reporterStage: prev.reporterStage,
  })
  const checkerHandle = Option.map(Option.fromNullishOr(checkers.resources), makeCheckerPoolHandle)
  const { passedPlans, failedChecks } = yield* checkPlansWithConfiguredCheckers(
    Option.getOrUndefined(checkerHandle),
    plan.runPlans,
  )
  const checkerResults = yield* Effect.forEach(
    failedChecks,
    ([mutantPlan, result]) => reporting.reportCheckFailure(toReportedMutant(mutantPlan.mutant), result),
    { concurrency: 1 },
  )
  const checkerRelease = yield* checkers.releaseInBackground
  const progressQueue = yield* RunEvents
  const completedRef = yield* Ref.make(0)
  const pathService = yield* Path.Path
  const context: RunContext = {
    prev,
    env,
    reporting,
    progressQueue,
    completedRef,
    plannedTotal: plan.plannedTotal,
    pathService,
  }
  const settledResults = [...rememberedResults, ...plan.earlyResults, ...checkerResults]
  yield* Effect.forEach(settledResults, (result) => announceSettledMutant(context, result), {
    concurrency: 1,
    discard: true,
  })
  const completedMutants = yield* Ref.make<readonly Mutant.RunMutantResult[]>(settledResults)
  const checkpointGate = yield* Semaphore.make(1)
  yield* checkpointMutationResults(context, completedMutants)
  const runResults = yield* withPhaseSpan(
    'mutationTest.batch',
    { total: plan.plannedTotal, testRunners: prev.concurrency.testRunners },
    () =>
      Stream.mapEffect(
        Stream.fromIterable(passedPlans),
        (runPlan) =>
          Effect.scoped(
            runOnePlan({ context, testRunnerPool, checkpointGate, completedMutants, plan: runPlan }),
          ),
        { concurrency: Math.max(1, testRunnerCapacity) },
      ).pipe(
        Stream.runFold(
          (): readonly Mutant.RunMutantResult[] => emptyRunResults,
          (acc, result) => [...acc, result],
        ),
      ),
  )
  const allResults = [...settledResults, ...runResults]
  const outcomeResult = yield* reporting.reportAll(
    reportingInputOf({ prev, env, results: allResults }),
  )
  yield* Fiber.await(checkerRelease)
  const doneNow = yield* Clock.currentTimeMillis
  const elapsed = Duration.millis(doneNow - env.runStartedAt)
  yield* Effect.logInfo(`Done in ${Duration.format(elapsed)}.`)
  return outcomeResult
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
    'mutationTest',
    {
      mutantCount: raw.prev.mutants.length,
      skippedMutantCount: partitionPlannable(raw.prev.mutants).dropped.length,
      testCount: raw.prev.dryRunResult.tests.length,
    },
    () => outcome,
  )

export const mutationTestCell = Sandwich.named(
  'stryker.mutation_test',
)((command: DryRunDone) =>
  Effect.gen(function*() {
    yield* Scope.Scope
    const prev = command
    const raw: MutationTestRaw = {
      _tag: 'MutationTestCommand',
      dryRunOnly: prev.options.dryRunOnly,
      allowEmpty: prev.options.allowEmpty,
      testCount: prev.dryRunResult.tests.length,
      isZero: prev.dryRunResult.tests.length === 0,
      prev,
    }
    return raw
  })
).decide(admitMutationTest).write({
  MutationTestDryRunOnly: (_decision, raw) => writeMutationTestOutcome({ raw, outcome: writeMutationTestDryRunOnly() }),
  MutationTestNoTests: (_decision, raw) => writeMutationTestOutcome({ raw, outcome: writeMutationTestNoTests() }),
  MutationTestProceed: (_decision, raw) => writeMutationTestOutcome({ raw, outcome: writeMutationTestProceed(raw) }),
  MutationTestError: ({ stage, reason }) =>
    Effect.fail(StageError.make({ stage, reason, cause: MutationTestError.make({ stage, reason }) })),
  CommandRejected: ({ issue }) => Effect.fail(StageError.make({ stage: 'mutationTest', reason: issue })),
})
