import { Cell, Sandwich } from '@systemfsoftware/effect-cell-types'
import { Mutant } from '@systemfsoftware/stryker-js-instrumenter'
import type { MutantTestCoverage } from '@systemfsoftware/stryker-js-instrumenter'
import type { RunPlan as MutantRunPlan } from '@systemfsoftware/stryker-js-instrumenter'
import type { RunMutantResult } from '@systemfsoftware/stryker-js-instrumenter'
import type * as reportSchema from '@systemfsoftware/stryker-js-instrumenter'
import {
  isCustomTestRunner,
  MutantTested,
  MutationTestingPlanReady,
} from '@systemfsoftware/stryker-js-plugin-interface'
import * as Clock from 'effect/Clock'
import * as Duration from 'effect/Duration'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as Match from 'effect/Match'
import * as Metric from 'effect/Metric'
import * as MutableHashMap from 'effect/MutableHashMap'
import * as Option from 'effect/Option'
import * as Path from 'effect/Path'
import type { PlatformError } from 'effect/PlatformError'
import * as Pool from 'effect/Pool'
import * as Queue from 'effect/Queue'
import * as Ref from 'effect/Ref'
import * as Result from 'effect/Result'
import * as Scope from 'effect/Scope'
import * as Semaphore from 'effect/Semaphore'
import * as Stream from 'effect/Stream'
import * as ChildProcessSpawner from 'effect/unstable/process/ChildProcessSpawner'
import { PhaseEntered, PlanKnown } from '../RunEvents.js'
import { RunEvents, RunMutantTested } from '../RunEvents.js'

import type { CheckerFailed, CheckResult, ExitClass } from '@systemfsoftware/stryker-js-plugin-interface'
import { WALL_CLOCK_TIMEOUT_REASON, wallClockTimeoutStopsRun } from '@systemfsoftware/stryker-js-plugin-interface'
import { admitMutationTest, MutationTestError } from '../admit-mutation-test.workflow.js'
import type { MutationTestDecision } from '../admit-mutation-test.workflow.js'
import { wireRecordOf } from '../checker-mutant-wire.js'
import type { CheckerContractBroken, CheckerCrash, CheckerResourceService } from '../Checker.js'
import { checkGroupedPlans, createCheckerFactory } from '../Checker.js'
import { REMEMBERED_REASON, toRelativeNormalizedFileName } from '../IncrementalDiff.paths.js'
import { checkerMutantsSkipped } from '../metrics.js'
import { toSchemaLocation } from '../mutant-result-mapping.js'
import { decidePlans, incrementalDiff, partitionRunPlans, sortRunPlans } from '../Mutants.js'
import { makeMutationReportingService } from '../mutation-reporting.js'
import type { MutationReportingService } from '../mutation-reporting.js'
import { MutationTestCommand } from '../MutationTest.schema.js'
import { missingWorkerEntry, resolveConfiguredWorkerSpawn } from '../plugin-worker-entry.js'
import { FILE_CONCURRENCY, readOriginal } from '../Project.js'
import type { Project } from '../Project.js'
import { reportFileName } from '../report-assembly.js'
import { offerReporterEvent, withPhaseSpan } from '../ReporterStream.js'
import { StageError } from '../Run.schema.js'
import { buildTestRunner, invalidatesRunnerPool, makeChildProcessTestRunner } from '../TestRunner.js'
import type { PooledTestRunner, PooledTestRunnerError } from '../TestRunner.js'
import { IdGenerator } from '../Worker.js'
import { ChildProcessCrashedError } from '../Worker.schema.js'
import { WorkerLauncher } from '../WorkerLauncher.js'
import type { DryRunDone } from './dry-run.cell.js'
import { RunEnvironment } from './RunEnvironment.js'
import type { StageServices } from './StageServices.js'

export interface MutationTestDone {
  readonly results: readonly RunMutantResult[]
  readonly verdict: ExitClass | null
}

const readCurrentRelativeFiles = (
  project: Project,
  basePath: string,
): Effect.Effect<Record<string, string>, PlatformError, FileSystem.FileSystem> =>
  Effect.gen(function*() {
    const entries = yield* Effect.forEach(
      MutableHashMap.values(project.files),
      (file) =>
        Effect.map(readOriginal(file), (content) =>
          [toRelativeNormalizedFileName(file.name, basePath), content] as const),
      { concurrency: FILE_CONCURRENCY },
    )
    return Object.fromEntries(entries)
  })

interface RememberedMutantResult {
  readonly mutantId: string
  readonly status: string
  readonly testsCompleted?: number | undefined
  readonly coveredBy?: readonly string[] | undefined
  readonly killedBy?: readonly string[] | undefined
}

const rememberedCoveredBy = (entry: RememberedMutantResult): { readonly coveredBy?: readonly string[] } =>
  Option.match(Option.fromNullishOr(entry.coveredBy), {
    onNone: (): { readonly coveredBy?: readonly string[] } => ({}),
    onSome: (coveredBy) => ({ coveredBy: [...coveredBy] }),
  })

const rememberedKilledBy = (entry: RememberedMutantResult): { readonly killedBy?: readonly string[] } =>
  Option.match(Option.fromNullishOr(entry.killedBy), {
    onNone: (): { readonly killedBy?: readonly string[] } => ({}),
    onSome: (killedBy) => ({ killedBy: [...killedBy] }),
  })

const rememberedCoverage = (entry: RememberedMutantResult): {
  readonly coveredBy?: readonly string[]
  readonly killedBy?: readonly string[]
} => ({
  ...rememberedCoveredBy(entry),
  ...rememberedKilledBy(entry),
})

const rememberedResultOf = (mutant: Mutant, entry: RememberedMutantResult): RunMutantResult =>
  Object.assign(
    {},
    mutant,
    {
      location: toSchemaLocation(mutant.location),
      status: entry.status,
      statusReason: REMEMBERED_REASON,
      testsCompleted: entry.testsCompleted,
    },
    rememberedCoverage(entry),
  )

const rememberedResultsOf = (
  mutants: readonly Mutant[],
  remembered: readonly RememberedMutantResult[],
): RunMutantResult[] => {
  const byId = new Map(mutants.map((mutant) => [mutant.id, mutant] as const))
  return remembered.flatMap((entry) =>
    Option.match(Option.fromNullishOr(byId.get(entry.mutantId)), {
      onNone: (): RunMutantResult[] => [],
      onSome: (mutant) => [rememberedResultOf(mutant, entry)],
    })
  )
}

const VALID_MUTANT_STATUSES = [
  'Killed',
  'Survived',
  'NoCoverage',
  'Timeout',
  'CompileError',
  'RuntimeError',
  'Ignored',
  'Pending',
] as const
type ValidMutantStatus = typeof VALID_MUTANT_STATUSES[number]
const VALID_MUTANT_STATUS_SET = new Set<string>(VALID_MUTANT_STATUSES)
function isMutantStatus(s: string): s is ValidMutantStatus {
  return VALID_MUTANT_STATUS_SET.has(s)
}

const toReportedMutant = (mutant: Mutant): MutantTestCoverage =>
  Object.assign(mutant, { coveredBy: mutant.coveredBy, static: mutant.static })

type CheckerSlot = {
  readonly checkerName: string
  readonly checker: CheckerResourceService
}[]

const CHECKER_ACQUIRE_RETRIES = 2

const isCheckerCrash = (error: StageError | CheckerCrash): boolean =>
  Match.value(error).pipe(
    Match.tag('ChildProcessCrashedError', 'OutOfMemoryError', () => true),
    Match.orElse(() => false),
  )

const makeCheckerPool = (
  prev: DryRunDone,
  idGenerator: Parameters<typeof createCheckerFactory>[3],
  projectDirectory: string,
): Effect.Effect<
  Pool.Pool<CheckerSlot, StageError | CheckerCrash> | undefined,
  never,
  Scope.Scope | ChildProcessSpawner.ChildProcessSpawner | WorkerLauncher | FileSystem.FileSystem | Path.Path
> =>
  Match.value(prev.options.checkers.length === 0).pipe(
    Match.when(true, () => Effect.as(Effect.void, undefined)),
    Match.orElse(() =>
      Pool.make({
        acquire: Effect.forEach(prev.options.checkers, (checker) =>
          Effect.gen(function*() {
            const resolved = yield* resolveConfiguredWorkerSpawn({
              loaded: prev.loadedPlugins,
              kind: 'Checker',
              configured: checker,
            }).pipe(Effect.mapError(missingWorkerEntry('mutationTest', 'checker', checker.plugin)))
            const service = yield* createCheckerFactory(
              { ...prev.options, checkers: [checker] },
              prev.project.fileDescriptions,
              resolved.spawn.entrypoint,
              idGenerator,
              projectDirectory,
            ).pipe(Effect.retry({ times: CHECKER_ACQUIRE_RETRIES, while: isCheckerCrash }))
            return { checkerName: resolved.name, checker: service }
          })),
        size: prev.concurrency.checkers,
      })
    ),
  )

interface MutationTestRaw {
  readonly prev: DryRunDone
}

interface CheckedPlans {
  readonly passedPlans: readonly MutantRunPlan[]
  readonly checkerResults: readonly RunMutantResult[]
}
const checkerBreachToStageError = (error: CheckerContractBroken | CheckerFailed): StageError =>
  Match.value(error).pipe(
    Match.tag('CheckerFailed', (failed) =>
      StageError.make({ stage: 'mutationTest', reason: failed.cause, cause: failed })),
    Match.tag('CheckerAnsweredUnrequested', (breach) =>
      StageError.make({
        stage: 'mutationTest',
        reason:
          `Checker "${breach.checkerName}" answered about mutants it was not asked about (${breach.phase} phase): ${
            breach.unrequestedIds.join(', ')
          }`,
        cause: breach,
      })),
    Match.tag('CheckerSkippedRequested', (breach) =>
      StageError.make({
        stage: 'mutationTest',
        reason: `Checker "${breach.checkerName}" skipped requested mutants (${breach.phase} phase): ${
          breach.missingIds.join(', ')
        }`,
        cause: breach,
      })),
    Match.exhaustive,
  )
const invalidateSlot = <A, E, I>(
  pool: Pool.Pool<A, I>,
  slot: A,
  error: E,
): Effect.Effect<never, E, Scope.Scope> => Effect.flatMap(Pool.invalidate(pool, slot), () => Effect.fail(error))

const checkSlotPlans = (
  pool: Pool.Pool<CheckerSlot, StageError | CheckerCrash>,
  slot: CheckerSlot,
  checker: CheckerResourceService,
  checkerName: string,
  currentPlans: readonly MutantRunPlan[],
): Effect.Effect<
  readonly (readonly [MutantRunPlan, CheckResult])[],
  StageError | CheckerCrash,
  Scope.Scope
> =>
  checkGroupedPlans(checker, checkerName, currentPlans).pipe(
    Effect.catchTags({
      OutOfMemoryError: (error) => invalidateSlot(pool, slot, error),
      ChildProcessCrashedError: (error) => invalidateSlot(pool, slot, error),
      CheckerAnsweredUnrequested: (error) => Effect.fail(checkerBreachToStageError(error)),
      CheckerSkippedRequested: (error) => Effect.fail(checkerBreachToStageError(error)),
      CheckerFailed: (error) => Effect.fail(checkerBreachToStageError(error)),
    }),
  )

const appendCheckOutcome = (
  plan: MutantRunPlan,
  result: CheckResult,
  reporting: MutationReportingService,
  passed: MutantRunPlan[],
  results: RunMutantResult[],
): Effect.Effect<void> => {
  if (result.status === 'passed') {
    passed.push(plan)
    return Effect.void
  }
  return reporting.reportCheckFailure(toReportedMutant(plan.mutant), result).pipe(
    Effect.map((reported) => {
      results.push(reported)
    }),
  )
}

const splitCheckedPlans = (
  checked: readonly (readonly [MutantRunPlan, CheckResult])[],
  reporting: MutationReportingService,
): Effect.Effect<{ passed: MutantRunPlan[]; results: RunMutantResult[] }> =>
  Effect.gen(function*() {
    const passed: MutantRunPlan[] = []
    const results: RunMutantResult[] = []
    for (const [plan, result] of checked) {
      yield* appendCheckOutcome(plan, result, reporting, passed, results)
    }
    return { passed, results }
  })

const stepOneChecker = (
  pool: Pool.Pool<CheckerSlot, StageError | CheckerCrash>,
  slot: CheckerSlot,
  checker: CheckerResourceService,
  checkerName: string,
  currentPlans: readonly MutantRunPlan[],
  reporting: MutationReportingService,
): Effect.Effect<{ passed: MutantRunPlan[]; results: RunMutantResult[] }, StageError | CheckerCrash, Scope.Scope> =>
  checkSlotPlans(pool, slot, checker, checkerName, currentPlans).pipe(
    Effect.flatMap((checked) => splitCheckedPlans(checked, reporting)),
  )

const runConfiguredCheckers = (
  pool: Pool.Pool<CheckerSlot, StageError | CheckerCrash>,
  plans: readonly MutantRunPlan[],
  reporting: MutationReportingService,
): Effect.Effect<CheckedPlans, StageError | CheckerCrash> =>
  Effect.scoped(
    Effect.gen(function*() {
      const slot = yield* Pool.get(pool)
      const allCheckerResults: RunMutantResult[] = []
      let currentPlans = plans
      for (const { checkerName, checker } of slot) {
        const split = yield* stepOneChecker(pool, slot, checker, checkerName, currentPlans, reporting)
        allCheckerResults.push(...split.results)
        currentPlans = split.passed
      }
      return { passedPlans: currentPlans, checkerResults: allCheckerResults }
    }),
  )

const checkPlansWithConfiguredCheckers = (
  checkerPool: Pool.Pool<CheckerSlot, StageError | CheckerCrash> | undefined,
  plans: readonly MutantRunPlan[],
  reporting: MutationReportingService,
): Effect.Effect<CheckedPlans, StageError | CheckerCrash> =>
  Option.match(Option.fromNullishOr(checkerPool), {
    onNone: () => Effect.succeed({ passedPlans: plans, checkerResults: [] }),
    onSome: (pool) => runConfiguredCheckers(pool, plans, reporting),
  })

const isPlannable = (mutant: Mutant): boolean => Result.isSuccess(wireRecordOf(mutant))

const DROPPED_IDS_IN_WARNING = 5

const partitionPlannable = (
  mutants: readonly Mutant[],
): { readonly plannable: readonly Mutant[]; readonly dropped: readonly Mutant[] } => {
  const plannable: Mutant[] = []
  const dropped: Mutant[] = []
  mutants.forEach((mutant) => {
    if (isPlannable(mutant)) plannable.push(mutant)
    else dropped.push(mutant)
  })
  return { plannable, dropped }
}

const droppedIdsOf = (dropped: readonly Mutant[]): string =>
  `${dropped.slice(0, DROPPED_IDS_IN_WARNING).map((mutant) => mutant.id).join(', ')}${
    Option.match(Option.liftPredicate(dropped.length, (count) => count > DROPPED_IDS_IN_WARNING), {
      onNone: () => '',
      onSome: (count) => `, +${count - DROPPED_IDS_IN_WARNING} more`,
    })
  }`

const reportDroppedMutants = (dropped: readonly Mutant[]): Effect.Effect<void> =>
  Match.value(dropped.length).pipe(
    Match.when(0, () => Effect.void),
    Match.orElse(() =>
      Effect.gen(function*() {
        yield* Metric.update(checkerMutantsSkipped, dropped.length)
        yield* Effect.logWarning(
          `${dropped.length} mutant(s) cannot be described to a checker and were left out of the run (${
            droppedIdsOf(dropped)
          })`,
        )
      })
    ),
  )

const stringReasonOrUndefined = <V = unknown>(val: V): string | undefined => typeof val === 'string' ? val : undefined
const reasonOf = (result: object): string | undefined =>
  'reason' in result ? stringReasonOrUndefined(result.reason) : undefined

const stopWallClock = (
  result: { readonly status: string; readonly reason?: string },
): Effect.Effect<void, StageError> => {
  if (!wallClockTimeoutStopsRun(result.status, reasonOf(result))) {
    return Effect.void
  }
  return Effect.fail(StageError.make({
    stage: 'mutationTest',
    reason: WALL_CLOCK_TIMEOUT_REASON,
  }))
}

export const mutationTestCell: Cell.Cell<DryRunDone, MutationTestDone, StageError, StageServices> = Sandwich.read((
  command: DryRunDone,
): Effect.Effect<MutationTestRaw, never, Scope.Scope> =>
  Effect.gen(function*() {
    yield* Scope.Scope
    const prev = command
    const raw: MutationTestRaw = { prev }
    return raw
  })
).decode(Sandwich.pure((raw: MutationTestRaw): Result.Result<MutationTestCommand, StageError> =>
  Result.succeed(
    MutationTestCommand.make({
      dryRunOnly: raw.prev.options.dryRunOnly,
      allowEmpty: raw.prev.options.allowEmpty,
      testCount: raw.prev.dryRunResult.tests.length,
      isZero: raw.prev.dryRunResult.tests.length === 0,
    }),
  )
)).decide(admitMutationTest).encode(Sandwich.pure((outcome) => Result.succeed(outcome))).write((
  outcome: Result.Result<MutationTestDecision, MutationTestError>,
  raw: MutationTestRaw,
): Effect.Effect<MutationTestDone, StageError, StageServices> => {
  const { dropped, plannable: plannableMutants } = partitionPlannable(raw.prev.mutants)
  return withPhaseSpan(
    'mutationTest',
    {
      mutantCount: raw.prev.mutants.length,
      skippedMutantCount: dropped.length,
      testCount: raw.prev.dryRunResult.tests.length,
    },
    () =>
      Effect.gen(function*() {
        yield* reportDroppedMutants(dropped)
        const decision = yield* Result.match(outcome, {
          onFailure: (err) => Effect.fail(StageError.make({ stage: err.stage, reason: err.reason, cause: err })),
          onSuccess: (d) => Effect.succeed(d),
        })
        return yield* Match.value(decision).pipe(
          Match.tag('MutationTestDryRunOnly', () =>
            Effect.gen(function*() {
              const env = yield* RunEnvironment
              const queue = yield* RunEvents
              const nowEmit = yield* Clock.currentTimeMillis
              yield* Queue.offer(
                queue,
                PhaseEntered.make({ phase: 'mutation-test', elapsedMs: nowEmit - env.runStartedAt }),
              )
              yield* Effect.logInfo('The dry-run has been completed successfully. No mutations have been executed.')
              const emptyOutcome: MutationTestDone = { results: [], verdict: null }
              return emptyOutcome
            })),
          Match.tag('MutationTestNoTests', () =>
            Effect.gen(function*() {
              const env = yield* RunEnvironment
              const queue = yield* RunEvents
              const now = yield* Clock.currentTimeMillis
              const elapsed = Duration.millis(now - env.runStartedAt)
              yield* Effect.logInfo(`Done in ${Duration.format(elapsed)}.`)
              const nowEmit = yield* Clock.currentTimeMillis
              yield* Queue.offer(
                queue,
                PhaseEntered.make({ phase: 'mutation-test', elapsedMs: nowEmit - env.runStartedAt }),
              )
              const emptyOutcome: MutationTestDone = { results: [], verdict: null }
              return emptyOutcome
            })),
          Match.tag('MutationTestProceed', () =>
            Effect.gen(function*() {
              const prev = raw.prev
              const env = yield* RunEnvironment
              const emitPhase = Effect.gen(function*() {
                const nowEmit = yield* Clock.currentTimeMillis
                const queue = yield* RunEvents
                yield* Queue.offer(
                  queue,
                  PhaseEntered.make({ phase: 'mutation-test', elapsedMs: nowEmit - env.runStartedAt }),
                )
              })
              yield* emitPhase
              const idGenerator = yield* IdGenerator
              const checkerPool = yield* makeCheckerPool(prev, idGenerator, env.basePath)
              const testRunnerContext = {
                options: prev.options,
                fileDescriptions: prev.project.fileDescriptions,
                sandboxWorkingDirectory: prev.sandbox.workingDirectory,
                idGenerator: idGenerator,
                retire: Effect.void,
                testFiles: prev.project.testFiles.map((file) => prev.sandbox.sandboxFileFor(file)),
              }
              const testRunnerPool: Pool.Pool<PooledTestRunner, StageError | PooledTestRunnerError> = yield* Pool
                .make({
                  acquire: buildTestRunner(
                    testRunnerContext,
                    Effect.suspend(() => {
                      const runnerConfigured = prev.options.testRunner
                      const runnerLabel = Match.value(runnerConfigured).pipe(
                        Match.when(isCustomTestRunner, (runner) => runner.plugin),
                        Match.orElse((name) => name),
                      )
                      return resolveConfiguredWorkerSpawn({
                        loaded: prev.loadedPlugins,
                        kind: 'TestRunner',
                        configured: runnerConfigured,
                      }).pipe(
                        Effect.mapError(missingWorkerEntry('mutationTest', 'test runner', runnerLabel)),
                        Effect.flatMap(({ spawn }) =>
                          makeChildProcessTestRunner({
                            options: prev.options,
                            fileDescriptions: prev.project.fileDescriptions,
                            sandboxWorkingDirectory: prev.sandbox.workingDirectory,
                            workerEntrypoint: spawn.entrypoint,
                            idGenerator: idGenerator,
                          })
                        ),
                      )
                    }),
                  ),
                  size: prev.concurrency.testRunners,
                })
              const reporting = makeMutationReportingService({
                reporterStage: prev.reporterStage,
                options: prev.options,
                project: prev.project,
                testCoverage: prev.testCoverage,
                runId: env.runId,
                resolvedMode: env.resolvedMode,
                sandboxDirectory: prev.sandbox.workingDirectory,
                basePath: env.basePath,
              })
              const sandboxFileByName: Record<string, string> = Object.fromEntries(
                [...MutableHashMap.keys(prev.project.filesToMutate)].map((name) => [
                  name,
                  prev.sandbox.sandboxFileFor(name),
                ]),
              )
              const currentRelativeFiles = yield* readCurrentRelativeFiles(prev.project, env.basePath)
              const incremental = incrementalDiff({
                currentMutants: plannableMutants,
                testCoverage: prev.testCoverage,
                incrementalReport: prev.project.incrementalReport,
                currentRelativeFiles,
                basePath: env.basePath,
                force: prev.options.force,
              })
              const rememberedResults = rememberedResultsOf(plannableMutants, incremental.remembered)
              yield* Effect.when(
                Effect.logInfo(
                  `Incremental mode: reusing ${rememberedResults.length} mutant result(s), running ${incremental.mutants.length} mutant(s).`,
                ),
                Effect.succeed(rememberedResults.length > 0),
              )
              const { runPlans, earlyResults: noCoverageResults } = partitionRunPlans(
                yield* decidePlans(
                  incremental.mutants,
                  prev.testCoverage,
                  {
                    disableBail: prev.options.disableBail,
                    timeoutMS: prev.options.timeoutMS,
                    timeoutFactor: prev.options.timeoutFactor,
                    ignoreStatic: prev.options.ignoreStatic,
                  },
                  Duration.toMillis(prev.timeOverhead),
                  undefined,
                  sandboxFileByName,
                ),
              )
              const sortedPlans = sortRunPlans(runPlans)
              const allPlansForReporter: readonly MutantRunPlan[] = [...sortedPlans]
              yield* offerReporterEvent(
                prev.reporterStage,
                MutationTestingPlanReady.make({
                  total: allPlansForReporter.length + noCoverageResults.length + rememberedResults.length,
                  plans: allPlansForReporter.map((plan) => ({
                    mutantId: plan.mutant.id,
                    plan: plan.plan,
                    netTime: plan.netTime,
                    reloadEnvironment: plan.runOptions.reloadEnvironment,
                  })),
                }),
              ).pipe(Effect.ignoreCause)
              {
                const queue2 = yield* RunEvents
                yield* Queue.offer(
                  queue2,
                  PlanKnown.make({ total: allPlansForReporter.length + noCoverageResults.length }),
                )
              }
              const { passedPlans, checkerResults } = yield* checkPlansWithConfiguredCheckers(
                checkerPool,
                sortedPlans,
                reporting,
              )
              const testRunnerStream = Stream.fromIterable(passedPlans)
              const plannedTotal = allPlansForReporter.length + noCoverageResults.length + rememberedResults.length
              const pathService = yield* Path.Path
              const progressQueue = yield* RunEvents
              const completedRef = yield* Ref.make(0)
              interface PreparedStreamableMutant {
                readonly status: ValidMutantStatus
                readonly file: string
                readonly location: reportSchema.Location
              }
              const preparedStreamableOf = (
                result: RunMutantResult,
              ): PreparedStreamableMutant | undefined => {
                if (!isMutantStatus(result.status)) {
                  return undefined
                }
                return {
                  status: result.status,
                  file: reportFileName(pathService.relative(env.basePath, result.fileName)),
                  location: toSchemaLocation(result.location),
                }
              }
              const toStreamEvent = (
                result: RunMutantResult,
                completed: number,
                prepared: PreparedStreamableMutant,
              ): MutantTested =>
                MutantTested.make({
                  id: result.id,
                  status: prepared.status,
                  file: prepared.file,
                  location: prepared.location,
                  mutator: result.mutatorName,
                  replacement: result.replacement,
                  completed,
                  total: plannedTotal,
                })
              const offerFinished = (
                result: RunMutantResult,
                prepared: PreparedStreamableMutant | undefined,
              ): Effect.Effect<number | undefined> =>
                Effect.gen(function*() {
                  if (prepared === undefined) {
                    return undefined
                  }
                  const completed = yield* Ref.updateAndGet(completedRef, (n) => n + 1)
                  yield* Queue.offer(
                    progressQueue,
                    RunMutantTested.make({
                      id: result.id,
                      status: prepared.status,
                      file: prepared.file,
                      location: prepared.location,
                      mutator: result.mutatorName,
                      replacement: result.replacement,
                      completed,
                      total: plannedTotal,
                    }),
                  )
                  return completed
                })
              const reportStreamTested = (
                result: RunMutantResult,
                completed: number,
                prepared: PreparedStreamableMutant,
              ): Effect.Effect<void> =>
                offerReporterEvent(prev.reporterStage, toStreamEvent(result, completed, prepared)).pipe(
                  Effect.tapCause((cause) => Effect.logWarning('Reporter stream failed handling mutantTested', cause)),
                  Effect.ignoreCause,
                )

              const offerStreamTested = (
                result: RunMutantResult,
                completed: number | undefined,
                prepared: PreparedStreamableMutant | undefined,
              ): Effect.Effect<void> =>
                Option.match(
                  Option.all([Option.fromNullishOr(completed), Option.fromNullishOr(prepared)] as const),
                  {
                    onNone: () => Effect.void,
                    onSome: ([done, streamable]) => reportStreamTested(result, done, streamable),
                  },
                )
              const announceSettledMutant = (result: RunMutantResult): Effect.Effect<void> =>
                Effect.gen(function*() {
                  const prepared = preparedStreamableOf(result)
                  const completed = yield* offerFinished(result, prepared)
                  yield* offerStreamTested(result, completed, prepared)
                })
              yield* Effect.forEach(
                [...rememberedResults, ...noCoverageResults, ...checkerResults],
                announceSettledMutant,
                { concurrency: 1, discard: true },
              )
              const completedMutants = yield* Ref.make<RunMutantResult[]>([
                ...rememberedResults,
                ...noCoverageResults,
                ...checkerResults,
              ])
              const checkpointGate = yield* Semaphore.make(1)
              yield* reporting.checkpoint(yield* Ref.get(completedMutants)).pipe(
                Effect.tapCause((cause) => Effect.logWarning('Failed to persist the mutation checkpoint', cause)),
                Effect.ignoreCause,
              )
              const persist = (result: RunMutantResult) =>
                checkpointGate.withPermits(1)(
                  Effect.gen(function*() {
                    const next = yield* Ref.updateAndGet(completedMutants, (prev) => [...prev, result])
                    yield* reporting.checkpoint(next).pipe(
                      Effect.tapCause((cause) => Effect.logWarning('Failed to persist the mutation checkpoint', cause)),
                      Effect.ignoreCause,
                    )
                  }),
                )
              const runResults: RunMutantResult[] = yield* withPhaseSpan(
                'mutationTest.batch',
                { total: plannedTotal, testRunners: prev.concurrency.testRunners },
                () =>
                  Stream.mapEffect(
                    testRunnerStream,
                    (plan) =>
                      Effect.scoped(
                        Effect.gen(function*() {
                          const pool = testRunnerPool
                          const runner = yield* Pool.get(pool)
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
                              OutOfMemoryError: (error) => invalidateSlot(pool, runner, error),
                              ChildProcessCrashedError: (error) => invalidateSlot(pool, runner, error),
                            }),
                          )
                          if (invalidatesRunnerPool(result.status, reasonOf(result))) {
                            return yield* invalidateSlot(
                              pool,
                              runner,
                              ChildProcessCrashedError.make({
                                pid: 0,
                                exit: { _tag: 'Signal', signal: 'SIGKILL' },
                                cause: 'wall-clock timeout',
                              }),
                            )
                          }
                          yield* stopWallClock(result)
                          const reported = yield* reporting.reportMutantRunResult(
                            toReportedMutant(plan.mutant),
                            result,
                          )
                          const prepared = preparedStreamableOf(reported)
                          const finished = yield* offerFinished(reported, prepared)
                          yield* offerStreamTested(reported, finished, prepared)
                          yield* persist(reported)
                          return reported
                        }),
                      ),
                    { concurrency: Math.max(1, prev.concurrency.testRunners) },
                  ).pipe(Stream.runCollect, Effect.map((chunk) => [...chunk])),
              )
              const allResults: RunMutantResult[] = [
                ...rememberedResults,
                ...noCoverageResults,
                ...checkerResults,
                ...runResults,
              ]
              const outcomeResult = yield* reporting.reportAll(allResults)
              const doneNow = yield* Clock.currentTimeMillis
              const elapsed = Duration.millis(doneNow - env.runStartedAt)
              yield* Effect.logInfo(`Done in ${Duration.format(elapsed)}.`)
              const finalOutcome: MutationTestDone = outcomeResult
              return finalOutcome
            })),
          Match.exhaustive,
        )
      }),
  ).pipe(
    Effect.mapError((cause) =>
      Match.value(cause).pipe(
        Match.tag('StageError', (stage) => stage),
        Match.tag(
          'ChildProcessCrashedError',
          'OutOfMemoryError',
          'PlatformError',
          'TestRunnerFailed',
          () => StageError.make({ stage: 'mutationTest', reason: 'Mutation testing failed', cause }),
        ),
        Match.exhaustive,
      )
    ),
  )
})
