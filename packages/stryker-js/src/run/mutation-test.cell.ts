import { Cell } from '@systemfsoftware/effect-cell-types'
import { Mutant } from '@systemfsoftware/stryker-js-instrumenter/mutants'
import type { MutantTestCoverage } from '@systemfsoftware/stryker-js-instrumenter/mutants'
import type { RunPlan as MutantRunPlan } from '@systemfsoftware/stryker-js-instrumenter/mutants'
import type { RunMutantResult } from '@systemfsoftware/stryker-js-instrumenter/mutants'
import type * as reportSchema from '@systemfsoftware/stryker-js-instrumenter/mutants'
import type { CheckResult, PassedCheckResult } from '@systemfsoftware/stryker-js-plugin-interface'
import {
  CheckerMutantFromMutant,
  isCustomTestRunner,
  MutantTested,
  MutationTestingPlanReady,
} from '@systemfsoftware/stryker-js-plugin-interface'
import * as Clock from 'effect/Clock'
import * as Duration from 'effect/Duration'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as Match from 'effect/Match'
import * as MutableHashMap from 'effect/MutableHashMap'
import * as Option from 'effect/Option'
import * as Path from 'effect/Path'
import type { PlatformError } from 'effect/PlatformError'
import * as Pool from 'effect/Pool'
import * as Queue from 'effect/Queue'
import * as Ref from 'effect/Ref'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import * as Scope from 'effect/Scope'
import * as Semaphore from 'effect/Semaphore'
import * as Stream from 'effect/Stream'
import * as ChildProcessSpawner from 'effect/unstable/process/ChildProcessSpawner'
import { PhaseEntered, PlanKnown } from '../RunEvents.js'
import { RunEvents, RunMutantTested } from '../RunEvents.js'

import type { ExitClass } from '@systemfsoftware/stryker-js-plugin-interface'
import { admitMutationTest, MutationTestError } from '../admit-mutation-test.workflow.js'
import type { MutationTestDecision } from '../admit-mutation-test.workflow.js'
import type { CheckerCrash, CheckerResourceService } from '../Checker.js'
import { checkGroupedPlans, createCheckerFactory } from '../Checker.js'
import { REMEMBERED_REASON, toRelativeNormalizedFileName } from '../IncrementalDiff.paths.js'
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
import { buildTestRunner, makeChildProcessTestRunner } from '../TestRunner.js'
import type { PooledTestRunner, PooledTestRunnerError } from '../TestRunner.js'
import { IdGenerator } from '../Worker.js'
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

const makeCheckerPool = (
  prev: DryRunDone,
  idGenerator: Parameters<typeof createCheckerFactory>[3],
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
              prev.sandbox.workingDirectory,
            )
            return { checkerName: resolved.name, checker: service }
          })),
        size: prev.concurrency.checkers,
      })
    ),
  )

interface MutationTestRaw {
  readonly prev: DryRunDone
}

const passedCheck = (result: CheckResult): result is PassedCheckResult => result.status === 'passed'

const reportCheckOutcome = (
  [plan, result]: readonly [MutantRunPlan, CheckResult],
  reporting: MutationReportingService,
): Effect.Effect<void> =>
  Match.value(result).pipe(
    Match.when(passedCheck, () => Effect.void),
    Match.orElse((failed) => reporting.reportCheckFailure(toReportedMutant(plan.mutant), failed).pipe(Effect.asVoid)),
  )

const checkPlansWithConfiguredCheckers = (
  checkerPool: Pool.Pool<CheckerSlot, StageError | CheckerCrash> | undefined,
  plans: readonly MutantRunPlan[],
  reporting: MutationReportingService,
) =>
  Option.match(Option.fromNullishOr(checkerPool), {
    onNone: () => Effect.succeed(plans),
    onSome: (pool) =>
      Effect.scoped(
        Effect.gen(function*() {
          const slot = yield* Pool.get(pool)
          return yield* Effect.reduce(
            slot,
            () => plans,
            (passed, { checkerName, checker }) =>
              checkGroupedPlans(checker, checkerName, passed).pipe(
                Effect.catchTags({
                  OutOfMemoryError: (error) => Effect.flatMap(Pool.invalidate(pool, slot), () => Effect.fail(error)),
                  ChildProcessCrashedError: (error) =>
                    Effect.flatMap(Pool.invalidate(pool, slot), () => Effect.fail(error)),
                }),
                Effect.flatMap((checked) =>
                  Effect.forEach(checked, (pair) => reportCheckOutcome(pair, reporting), {
                    concurrency: 1,
                    discard: true,
                  }).pipe(
                    Effect.as(
                      checked.filter(([, result]) => result.status === 'passed').map(([plan]) => plan),
                    ),
                  )
                ),
              ),
          )
        }),
      ),
  })

const isPlannable = (mutant: Mutant): boolean =>
  Result.isSuccess(S.decodeUnknownResult(CheckerMutantFromMutant)(mutant))

const plannableMutantsOf = (mutants: readonly Mutant[]): readonly Mutant[] => mutants.filter(isPlannable)

export const mutationTestCell: Cell.Cell<DryRunDone, MutationTestDone, StageError, StageServices> = Cell.layer({
  read: (command: DryRunDone): Effect.Effect<MutationTestRaw, never, Scope.Scope> =>
    Effect.gen(function*() {
      yield* Scope.Scope
      const prev = command
      const raw: MutationTestRaw = { prev }
      return raw
    }),
  decode: (raw: MutationTestRaw): Result.Result<MutationTestCommand, StageError> =>
    Result.succeed(
      MutationTestCommand.make({
        dryRunOnly: raw.prev.options.dryRunOnly,
        allowEmpty: raw.prev.options.allowEmpty,
        testCount: raw.prev.dryRunResult.tests.length,
        isZero: raw.prev.dryRunResult.tests.length === 0,
      }),
    ),
  decide: admitMutationTest,
  encode: (outcome) => outcome,
  write: (
    outcome: Result.Result<MutationTestDecision, MutationTestError>,
    raw: MutationTestRaw,
  ): Effect.Effect<MutationTestDone, StageError, StageServices> => {
    const plannableMutants = plannableMutantsOf(raw.prev.mutants)
    return withPhaseSpan(
      'mutationTest',
      {
        mutantCount: raw.prev.mutants.length,
        skippedMutantCount: raw.prev.mutants.length - plannableMutants.length,
        testCount: raw.prev.dryRunResult.tests.length,
      },
      () =>
        Effect.gen(function*() {
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
                const checkerPool = yield* makeCheckerPool(prev, idGenerator)
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
                const passedPlans = yield* checkPlansWithConfiguredCheckers(checkerPool, sortedPlans, reporting)
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
                    Effect.catchCause((cause) =>
                      Effect.logWarning('Reporter stream failed handling mutantTested', cause)
                    ),
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
                  [...rememberedResults, ...noCoverageResults],
                  announceSettledMutant,
                  { concurrency: 1, discard: true },
                )
                const completedMutants = yield* Ref.make<RunMutantResult[]>([
                  ...rememberedResults,
                  ...noCoverageResults,
                ])
                const checkpointGate = yield* Semaphore.make(1)
                yield* reporting.checkpoint(yield* Ref.get(completedMutants)).pipe(
                  Effect.catchCause((cause) => Effect.logWarning('Failed to persist the mutation checkpoint', cause)),
                )
                const persist = (result: RunMutantResult) =>
                  checkpointGate.withPermits(1)(
                    Effect.gen(function*() {
                      const next = yield* Ref.updateAndGet(completedMutants, (prev) => [...prev, result])
                      yield* reporting.checkpoint(next).pipe(
                        Effect.catchCause((cause) =>
                          Effect.logWarning('Failed to persist the mutation checkpoint', cause)
                        ),
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
                              Effect.catchTags({
                                OutOfMemoryError: (error) =>
                                  Effect.flatMap(Pool.invalidate(pool, runner), () => Effect.fail(error)),
                                ChildProcessCrashedError: (error) =>
                                  Effect.flatMap(Pool.invalidate(pool, runner), () => Effect.fail(error)),
                              }),
                            )
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
                const allResults: RunMutantResult[] = [...rememberedResults, ...noCoverageResults, ...runResults]
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
            'CheckerAnsweredUnrequested',
            (breach) =>
              StageError.make({
                stage: 'mutationTest',
                reason:
                  `Checker "${breach.checkerName}" answered about mutants it was not asked about (${breach.phase} phase): ${
                    breach.unrequestedIds.join(', ')
                  }`,
                cause: breach,
              }),
          ),
          Match.tag(
            'CheckerSkippedRequested',
            (breach) =>
              StageError.make({
                stage: 'mutationTest',
                reason: `Checker "${breach.checkerName}" skipped requested mutants (${breach.phase} phase): ${
                  breach.missingIds.join(', ')
                }`,
                cause: breach,
              }),
          ),
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
  },
})
