import { Sandwich } from '@systemfsoftware/effect-cell-types'
import { Mutant } from '@systemfsoftware/stryker-js-instrumenter'
import type {
  MutantTestCoverage,
  RunPlan,
  TestResult,
} from '@systemfsoftware/stryker-js-instrumenter'
import type { RunPlan as MutantRunPlan } from '@systemfsoftware/stryker-js-instrumenter'
import type { RunMutantResult } from '@systemfsoftware/stryker-js-instrumenter'
import type { TestCoverage } from '../test-coverage.schema.js'
import type * as reportSchema from '@systemfsoftware/stryker-js-instrumenter'
import {
  isCustomTestRunner,
  MutantTested,
  MutationTestingPlanReady,
} from '@systemfsoftware/stryker-js-plugin-interface'
import * as Boolean from 'effect/Boolean'
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
import * as Predicate from 'effect/Predicate'
import * as Queue from 'effect/Queue'
import * as Ref from 'effect/Ref'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import * as Scope from 'effect/Scope'
import * as Semaphore from 'effect/Semaphore'
import * as Stream from 'effect/Stream'
import * as ChildProcessSpawner from 'effect/unstable/process/ChildProcessSpawner'
import { PhaseEntered } from '../run-events.service.js'
import { RunEvents, RunMutantTested } from '../run-events.service.js'

import type {
  CheckerFailed,
  CheckResult,
  ExitClass,
  FailedCheckResult,
  MutationTestResult,
  WorkerPluginKind,
} from '@systemfsoftware/stryker-js-plugin-interface'
import { WALL_CLOCK_TIMEOUT_REASON, wallClockTimeoutStopsRun } from '@systemfsoftware/stryker-js-plugin-interface'
import { admitMutationTest, MutationTestError } from '../admit-mutation-test.workflow.js'
import { MutationTestCommand } from '../MutationTest.schema.js'
import { CheckerMutantFromMutant } from '../Checker/mod.js'
import type { CheckerContractBroken, CheckerCrash, CheckerResourceService } from '../Checker/mod.js'
import { checkGroupedPlans, scoped } from '../Checker/mod.js'
import { checkerMutantsSkipped } from '../metrics.js'
import { ReportLocation } from '../ReportLocation.schema.js'
import { UnknownPlannedMutant } from '../MutantsError.schema.js'
import { MutationReporting } from '../mutation-reporting.service.js'
import type { MutationReportingInput, MutationReportingService } from '../mutation-reporting.service.js'
import { PreviousFilesSchema, PreviousTestFilesSchema } from '../IncrementalDiff.schema.js'
import { RelativeNormalizedFileName } from '../matching.schema.js'
import {
  MutantTestPlanCommand,
  planMutantTests,
} from '../plan-mutant-tests.workflow.js'
import {
  IncrementalDiffCommand,
  incrementalDiff as incrementalDiffDecisions,
  type IncrementalDiffDecision,
} from '../incremental-diff.workflow.js'
import type { Project } from '../Project.schema.js'
import type { SandboxHandle } from '../Sandbox.handle.js'
import { reportFileName } from '../report-assembly.js'
import { offerReporterEvent, withPhaseSpan } from '../reporter-stream.service.js'
import { StageError } from '../Run.schema.js'
import { buildTestRunner, makeChildProcessTestRunner } from '../TestRunner.resource.js'
import { invalidatesRunnerPool, type PooledTestRunner } from '../pooled-test-runner.handle.js'
import type { PooledTestRunnerError } from '../TestRunner.schema.js'
import { IdGenerator } from '../Worker.service.js'
import { ChildProcessCrashedError } from '../Worker.schema.js'
import { WorkerLauncher } from '../WorkerLauncher.service.js'
import type { DryRunDone } from './dry-run.cell.js'
import { RunEnvironment, type RunEnvironmentShape } from './RunEnvironment.service.js'
import {
  ConfiguredPluginModulePath,
  ConfiguredPluginName,
  resolveConfiguredPlugin,
  WorkerSpawnCommand,
  type WorkerSpawnResolved,
} from './resolve-configured-plugin.workflow.js'
import type { StageServices } from './StageServices.service.js'

export interface MutationTestDone {
  readonly results: readonly RunMutantResult[]
  readonly verdict: ExitClass | null
}

const readCurrentRelativeFiles = (
  project: Project,
  basePath: string,
): Effect.Effect<Record<string, string>, PlatformError, ProjectFiles> =>
  Effect.gen(function*() {
    const projectFiles = yield* ProjectFiles
    const entries = yield* projectFiles.readAllOriginal(MutableHashMap.values(project.files))
    return Object.fromEntries(
      entries.map(([file, content]) => [toRelativeNormalizedFileName(file.name, basePath), content] as const),
    )
  })

const reportingInputOf = (
  prev: DryRunDone,
  env: RunEnvironmentShape,
  results: readonly RunMutantResult[],
): MutationReportingInput => ({
  results,
  options: prev.options,
  project: prev.project,
  testCoverage: prev.testCoverage,
  runId: env.runId,
  resolvedMode: env.resolvedMode,
  basePath: env.basePath,
  reporterStage: prev.reporterStage,
})

const sandboxFilePairsOf = (sandbox: SandboxHandle, fileNames: readonly string[]) =>
  Result.all(
    fileNames.map((fileName) =>
      Result.map(
        sandbox.sandboxFileFor(fileName),
        (sandboxFileName): readonly [string, string] => [fileName, sandboxFileName],
      )
    ),
  )

const sandboxFilesOf = (sandbox: SandboxHandle, fileNames: readonly string[]) =>
  Effect.fromResult(sandboxFilePairsOf(sandbox, fileNames)).pipe(
    Effect.mapError((cause) =>
      StageError.make({ stage: 'mutationTest', reason: 'Failed to resolve sandbox file', cause })
    ),
  )

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

const REMEMBERED_REASON = 'Remembered'

const rememberedResultOf = (
  mutant: Mutant,
  entry: RememberedMutantResult,
  reportLocation: reportSchema.Location,
): RunMutantResult =>
  Object.assign(
    {},
    mutant,
    {
      location: reportLocation,
      status: entry.status,
      statusReason: REMEMBERED_REASON,
      testsCompleted: entry.testsCompleted,
    },
    rememberedCoverage(entry),
  )

const mutantsByIdOf = (mutants: readonly Mutant[]) => new Map(mutants.map((mutant) => [mutant.id, mutant] as const))

const rememberedOf = (mutant: Mutant, entry: RememberedMutantResult) =>
  rememberedResultOf(mutant, entry, ReportLocation.fromMutant(mutant.location).location)
const rememberedResultsOf = (
  mutants: readonly Mutant[],
  remembered: readonly RememberedMutantResult[],
) => {
  const byId = mutantsByIdOf(mutants)
  return remembered.flatMap((entry) =>
    Option.match(Option.fromUndefinedOr(byId.get(entry.mutantId)), {
      onNone: (): ReadonlyArray<RunMutantResult> => [],
      onSome: (mutant) => [rememberedOf(mutant, entry)],
    }))
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
const isMutantStatus = (candidate: string): candidate is ValidMutantStatus =>
  Array.contains(VALID_MUTANT_STATUSES, candidate)

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

const configuredPluginOf = (configured: string | { readonly plugin: string }) =>
  Match.value(configured).pipe(
    Match.when(isCustomTestRunner, (custom) => ConfiguredPluginModulePath.make({ modulePath: custom.plugin })),
    Match.orElse((name) => ConfiguredPluginName.make({ name })),
  )

const workerSpawnOf = (
  stage: StageError['stage'],
  loaded: Pick<LoadedPlugins, 'pluginSources'>,
  kind: WorkerPluginKind,
  configured: ConfiguredPluginName | ConfiguredPluginModulePath,
): Effect.Effect<WorkerSpawnResolved, StageError> =>
  Effect.mapError(
    Effect.fromResult(
      resolveConfiguredPlugin(WorkerSpawnCommand.make({ sources: loaded.pluginSources, kind, configured })),
    ),
    (missing) =>
      StageError.make({ stage, reason: missing.reason, cause: PluginNotFoundError.make({ descriptor: missing.descriptor }) }),
  )

const calculateTotalTime = (testResults: Iterable<TestResult>) =>
  [...testResults].reduce((acc, test) => acc + test.timeSpentMs, 0)

const toTestIds = (testResults: Iterable<TestResult>) => [...testResults].map((test) => test.id)

const hitsRecordOf = (testCoverage: TestCoverage) =>
  Object.fromEntries([...testCoverage.hitsByMutantId])

const testsByMutantIdRecordOf = (testCoverage: TestCoverage) =>
  Object.fromEntries(
    [...testCoverage.testsByMutantId].map(([mutantId, tests]) => [mutantId, toTestIds(tests)]),
  )

const testTimeRecordOf = (testCoverage: TestCoverage) =>
  Object.fromEntries([...testCoverage.testsById].map(([id, result]) => [id, result.timeSpentMs]))

const planCommandOf = (
  mutants: readonly Mutant[],
  testCoverage: TestCoverage,
  options: {
    readonly disableBail: boolean
    readonly timeoutMS: number
    readonly timeoutFactor: number
    readonly ignoreStatic: boolean
  },
  timeOverheadMS: number,
  globalTestFilter: string[] | undefined,
  sandboxFileByName: Record<string, string>,
) =>
  MutantTestPlanCommand.make({
    mutants: [...mutants],
    timeOverheadMS,
    timeSpentAllTests: calculateTotalTime(MutableHashMap.values(testCoverage.testsById)),
    hitsByMutantId: hitsRecordOf(testCoverage),
    testsByMutantId: testsByMutantIdRecordOf(testCoverage),
    testTimeById: testTimeRecordOf(testCoverage),
    options,
    sandboxFileByName,
    ...Option.match(Option.fromUndefinedOr(testCoverage.staticCoverage), {
      onNone: () => ({}),
      onSome: (staticCoverage) => ({ staticCoverage }),
    }),
    ...Option.match(Option.fromUndefinedOr(globalTestFilter), {
      onNone: () => ({}),
      onSome: (testFilter) => ({ globalTestFilter: testFilter }),
    }),
  })

const firstDefined = <Value>(first: Value | undefined, second: Value | undefined) =>
  Option.getOrElse(Option.fromNullishOr(first), () => second)

const materializeMutant = (
  original: Mutant,
  decided: {
    readonly status?: Mutant['status'] | undefined
    readonly statusReason?: string | undefined
    readonly static?: boolean | undefined
    readonly coveredBy?: readonly string[] | undefined
  },
) =>
  Mutant.make({
    id: original.id,
    fileName: original.fileName,
    mutatorName: original.mutatorName,
    replacement: original.replacement,
    location: original.location,
    ...Option.match(Option.fromUndefinedOr(firstDefined(decided.status, original.status)), {
      onNone: () => ({}),
      onSome: (status) => ({ status }),
    }),
    ...Option.match(Option.fromUndefinedOr(firstDefined(decided.statusReason, original.statusReason)), {
      onNone: () => ({}),
      onSome: (statusReason) => ({ statusReason }),
    }),
    ...Option.match(Option.fromUndefinedOr(firstDefined(decided.static, original.static)), {
      onNone: () => ({}),
      onSome: (isStatic) => ({ static: isStatic }),
    }),
    ...Option.match(Option.fromUndefinedOr(firstDefined(decided.coveredBy, original.coveredBy)), {
      onNone: () => ({}),
      onSome: (coveredBy) => ({ coveredBy }),
    }),
    ...Option.match(Option.fromUndefinedOr(original.testsCompleted), {
      onNone: () => ({}),
      onSome: (testsCompleted) => ({ testsCompleted }),
    }),
    ...Option.match(Option.fromUndefinedOr(original.description), {
      onNone: () => ({}),
      onSome: (description) => ({ description }),
    }),
  })

const decidePlans = (
  input: Readonly<{
    mutants: readonly Mutant[]
    testCoverage: TestCoverage
    options: {
      readonly disableBail: boolean
      readonly timeoutMS: number
      readonly timeoutFactor: number
      readonly ignoreStatic: boolean
    }
    timeOverheadMS: number
    globalTestFilter: string[] | undefined
    sandboxFileByName: Record<string, string>
  }>,
) => {
  const command = planCommandOf(
    input.mutants,
    input.testCoverage,
    input.options,
    input.timeOverheadMS,
    input.globalTestFilter,
    input.sandboxFileByName,
  )
  const byId = new Map(input.mutants.map((mutant) => [mutant.id, mutant] as const))
  return Effect.flatMap(
    Effect.fromResult(planMutantTests(command)).pipe(
      Effect.mapError((failure) => StageError.make({ stage: 'mutationTest', reason: failure.reason })),
    ),
    (decisions) =>
      Effect.forEach(decisions, (plan) =>
        Option.match(Option.fromUndefinedOr(byId.get(plan.mutantId)), {
          onNone: () =>
            Effect.die(UnknownPlannedMutant.make({
              mutantId: plan.mutantId,
              message: `planner returned an unknown mutant id: ${plan.mutantId}`,
            })),
          onSome: (mutant) =>
            Match.tag(plan, {
              PlannedRunMutant: (run) =>
                Effect.succeed({
                  plan: 'Run' as const,
                  mutant: materializeMutant(mutant, run),
                  netTime: run.netTime,
                  runOptions: {
                    activeMutant: materializeMutant(mutant, run),
                    mutantActivation: run.runOptions.mutantActivation,
                    timeout: run.runOptions.timeout,
                    sandboxFileName: run.runOptions.sandboxFileName,
                    disableBail: run.runOptions.disableBail,
                    reloadEnvironment: run.runOptions.reloadEnvironment,
                    ...Option.match(Option.fromUndefinedOr(run.runOptions.testFilter), {
                      onNone: () => ({}),
                      onSome: (testFilter) => ({ testFilter }),
                    }),
                    ...Option.match(Option.fromUndefinedOr(run.runOptions.hitLimit), {
                      onNone: () => ({}),
                      onSome: (hitLimit) => ({ hitLimit }),
                    }),
                  },
                }),
              PlannedEarlyResultMutant: (early) =>
                Effect.succeed({
                  plan: 'EarlyResult' as const,
                  mutant: materializeMutant(mutant, early),
                }),
            }),
        })),
  )
}

const isEarlyPlan = (plan: MutantTestPlan): plan is Extract<MutantTestPlan, { readonly plan: 'EarlyResult' }> =>
  !isRunPlan(plan)

const earlyResultOf = (plan: Extract<MutantTestPlan, { readonly plan: 'EarlyResult' }>) =>
  Object.assign({}, plan.mutant, {
    location: ReportLocation.fromMutant(plan.mutant.location).location,
    status: plan.mutant.status ?? 'Ignored',
  })

const partitionRunPlans = (plans: readonly MutantTestPlan[]) => ({
  runPlans: plans.filter(isRunPlan),
  earlyPlans: plans.filter(isEarlyPlan),
})

const earlyResultOf = (plan: Extract<MutantTestPlan, { readonly plan: 'EarlyResult' }>) =>
  Object.assign({}, plan.mutant, {
    location: ReportLocation.fromMutant(plan.mutant.location).location,
    status: plan.mutant.status ?? 'Ignored',
  })

const byReloadEnvironment = (left: RunPlan, right: RunPlan) =>
  Number(left.runOptions.reloadEnvironment) - Number(right.runOptions.reloadEnvironment)

const sortRunPlans = (plans: readonly RunPlan[]) => [...plans].sort(byReloadEnvironment)

const previousFilesFieldOf = (report: { readonly files: unknown }) =>
  Option.getOrElse(
    S.decodeUnknownResult(PreviousFilesSchema)(report.files),
    (): S.Schema.Type<typeof PreviousFilesSchema> => ({}),
  )

const previousFilesOf = (rawReport: unknown) =>
  Predicate.isObject(rawReport) && Predicate.hasProperty(rawReport, 'files')
    ? previousFilesFieldOf(rawReport)
    : {}

const previousTestFilesFieldOf = (report: { readonly testFiles: unknown }) =>
  Option.getOrElse(
    S.decodeUnknownResult(PreviousTestFilesSchema)(report.testFiles),
    (): S.Schema.Type<typeof PreviousTestFilesSchema> => ({}),
  )

const previousTestFilesOf = (rawReport: unknown) =>
  Predicate.isObject(rawReport) && Predicate.hasProperty(rawReport, 'testFiles')
    ? previousTestFilesFieldOf(rawReport)
    : {}

const relativeFileOfTest = (result: TestResult & { readonly fileName: string }) =>
  RelativeNormalizedFileName.fromAbsolute(result.fileName, '').fileName

const coveredFilesOfTests = (tests: Iterable<TestResult>) =>
  [...new Set(
    [...tests].flatMap((result) =>
      Option.match(Option.filter(Option.some(result), hasTestFileName), {
        onNone: () => [] as const,
        onSome: (located) => [relativeFileOfTest(located)] as const,
      })),
  )]

const coveringTestFilesByMutantIdOf = (testCoverage: TestCoverage) =>
  Object.fromEntries(
    [...testCoverage.testsByMutantId].map(([mutantId, tests]) => [mutantId, coveredFilesOfTests(tests)] as const),
  )


const relativeFileByMutantIdOf = (currentMutants: readonly Mutant[], basePath: string) =>
  Object.fromEntries(
    currentMutants.map((mutant) =>
      [mutant.id, RelativeNormalizedFileName.fromAbsolute(mutant.fileName, basePath).fileName] as const),
  )

const incrementalDiffCommandOf = (
  currentMutants: readonly Mutant[],
  testCoverage: TestCoverage,
  incrementalReport: MutationTestResult | undefined,
  currentRelativeFiles: Record<string, string>,
  basePath: string,
  force: boolean,
) =>
  IncrementalDiffCommand.make({
    currentMutants: [...currentMutants],
    relativeFileByMutantId: relativeFileByMutantIdOf(currentMutants, basePath),
    previousFiles: previousFilesOf(incrementalReport),
    previousTestFiles: previousTestFilesOf(incrementalReport),
    currentRelativeFiles,
    testIdsByRelativeFile: testIdsByRelativeFileOf(testCoverage),
    coveringTestFilesByMutantId: coveringTestFilesByMutantIdOf(testCoverage),
    force,
  })

const incrementalDiff = (
  input: Readonly<{
    currentMutants: readonly Mutant[]
    testCoverage: TestCoverage
    incrementalReport: MutationTestResult | undefined
    currentRelativeFiles: Record<string, string>
    basePath: string
    force?: boolean
  }>,
) =>
  Effect.gen(function*() {
    const command = incrementalDiffCommandOf(
      input.currentMutants,
      input.testCoverage,
      input.incrementalReport,
      input.currentRelativeFiles,
      input.basePath,
      input.force ?? false,
    )
    const decisions = yield* Effect.fromResult(incrementalDiffDecisions(command))
    return {
      mutants: decisions.flatMap((decision) => mutantsOfDecision(decision)),
      remembered: decisions.flatMap((decision) => rememberedOfDecision(decision)),
    }
  })

const mutantsOfDecision = (decision: IncrementalDiffDecision) =>
  Match.value(decision).pipe(
    Match.tag('MutantToRun', (run) => [run.mutant] as const),
    Match.tag('MutantRemembered', () => [] as const),
    Match.exhaustive,
  )

const rememberedOfDecision = (decision: IncrementalDiffDecision) =>
  Match.value(decision).pipe(
    Match.tag('MutantToRun', () => [] as const),
    Match.tag('MutantRemembered', (remembered) =>
      [{
        mutantId: remembered.mutantId,
        status: remembered.status,
        testsCompleted: remembered.testsCompleted,
        coveredBy: remembered.coveredBy,
        killedBy: remembered.killedBy,
      }] as const),
    Match.exhaustive,
  )

const makeCheckerPool = (
  prev: DryRunDone,
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
            const resolved = yield* workerSpawnOf(
              'mutationTest',
              prev.loadedPlugins,
              'Checker',
              ConfiguredPluginModulePath.make({ modulePath: checker.plugin }),
            )
            const service = yield* scoped({
              options: { ...prev.options, checkers: [checker] },
              workerEntrypoint: resolved.entrypoint,
              workingDirectory: projectDirectory,
            }).pipe(Effect.retry({ times: CHECKER_ACQUIRE_RETRIES, while: isCheckerCrash }))
            return { checkerName: resolved.name, checker: service }
          })),
        size: prev.concurrency.checkers,
      })
    ),
  )

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
      CheckerAnsweredUnrequested: (error) => error.pipe(checkerBreachToStageError, Effect.fail),
      CheckerSkippedRequested: (error) => error.pipe(checkerBreachToStageError, Effect.fail),
      CheckerFailed: (error) => error.pipe(checkerBreachToStageError, Effect.fail),
    }),
  )

const isFailedCheck = (
  check: readonly [MutantRunPlan, CheckResult],
): check is readonly [MutantRunPlan, FailedCheckResult] => check[1].status !== 'passed'

const splitCheckedPlans = (
  checked: readonly (readonly [MutantRunPlan, CheckResult])[],
  reporting: MutationReportingService,
) => {
  const failures = Array.filter(checked, isFailedCheck)
  const passed = Array.map(
    Array.filter(checked, ([, result]) => result.status === 'passed'),
    ([plan]) => plan,
  )
  return Effect.map(
    Effect.forEach(
      failures,
      ([plan, result]) => reporting.reportCheckFailure(toReportedMutant(plan.mutant), result),
      { concurrency: 1 },
    ),
    (results) => ({ passed, results }),
  )
}

const stepOneChecker = (
  pool: Pool.Pool<CheckerSlot, StageError | CheckerCrash>,
  slot: CheckerSlot,
  checker: CheckerResourceService,
  checkerName: string,
  currentPlans: readonly MutantRunPlan[],
  reporting: MutationReportingService,
) =>
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
      return yield* Effect.reduce(
        slot,
        () => ({ passedPlans: plans, checkerResults: Array.empty<RunMutantResult>() }),
        (acc, { checkerName, checker }) =>
          Effect.map(stepOneChecker(pool, slot, checker, checkerName, acc.passedPlans, reporting), (split) => ({
            passedPlans: split.passed,
            checkerResults: [...acc.checkerResults, ...split.results],
          })),
      )
    }),
  )

const checkPlansWithConfiguredCheckers = (
  checkerPool: Pool.Pool<CheckerSlot, StageError | CheckerCrash> | undefined,
  plans: readonly MutantRunPlan[],
  reporting: MutationReportingService,
) =>
  Option.match(Option.fromNullishOr(checkerPool), {
    onNone: () => Effect.succeed({ passedPlans: plans, checkerResults: Array.empty<RunMutantResult>() }),
    onSome: (pool) => runConfiguredCheckers(pool, plans, reporting),
  })

const isPlannable = (mutant: Mutant): boolean => Result.isSuccess(S.decodeResult(CheckerMutantFromMutant)(mutant))

const DROPPED_IDS_IN_WARNING = 5

const partitionPlannable = (mutants: readonly Mutant[]) => ({
  plannable: Array.filter(mutants, isPlannable),
  dropped: Array.filter(mutants, (candidate) => !isPlannable(candidate)),
})

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

const reasonOf = (result: object) =>
  Option.getOrUndefined(
    Option.filter(Option.fromNullishOr(Reflect.get(result, 'reason')), Predicate.isString),
  )

const stopWallClock = (result: { readonly status: string; readonly reason?: string }) =>
  Boolean.match(wallClockTimeoutStopsRun(result.status, reasonOf(result)), {
    onTrue: () => Effect.void,
    onFalse: () => Effect.fail(StageError.make({ stage: 'mutationTest', reason: WALL_CLOCK_TIMEOUT_REASON })),
  })

type MutationTestRaw = typeof MutationTestCommand.Encoded & {
  readonly prev: DryRunDone
}

const writeMutationTestNoTests = () =>
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
    return { results: [], verdict: null }
  })

const writeMutationTestDryRunOnly = () =>
  Effect.gen(function*() {
    const env = yield* RunEnvironment
    const queue = yield* RunEvents
    const nowEmit = yield* Clock.currentTimeMillis
    yield* Queue.offer(
      queue,
      PhaseEntered.make({ phase: 'mutation-test', elapsedMs: nowEmit - env.runStartedAt }),
    )
    yield* Effect.logInfo('The dry-run has been completed successfully. No mutations have been executed.')
    return { results: [], verdict: null }
  })

const emitMutationTestPhase = () =>
  Effect.gen(function*() {
    const env = yield* RunEnvironment
    const queue = yield* RunEvents
    const nowEmit = yield* Clock.currentTimeMillis
    yield* Queue.offer(
      queue,
      PhaseEntered.make({ phase: 'mutation-test', elapsedMs: nowEmit - env.runStartedAt }),
    )
  })

const writeMutationTestProceed = (raw: MutationTestRaw): Effect.Effect<
  MutationTestDone,
  StageError,
  StageServices
> =>
  Effect.gen(function*() {
    const prev = raw.prev
    const { dropped, plannable: plannableMutants } = partitionPlannable(prev.mutants)
    yield* reportDroppedMutants(dropped)
    yield* emitMutationTestPhase()
    const env = yield* RunEnvironment
    const idGenerator = yield* IdGenerator
    const checkerPool = yield* makeCheckerPool(prev, env.basePath)
    const testFiles = yield* Effect.map(
      sandboxFilesOf(prev.sandbox, prev.project.testFiles),
      Array.map(([, sandboxFileName]) => sandboxFileName),
    )
    const testRunnerContext = {
      options: prev.options,
      fileDescriptions: prev.project.fileDescriptions,
      sandboxWorkingDirectory: prev.sandbox.workingDirectory,
      idGenerator: idGenerator,
      retire: Effect.void,
      testFiles,
    }
    const testRunnerPool: Pool.Pool<PooledTestRunner, StageError | PooledTestRunnerError> = yield* Pool
      .make({
        acquire: buildTestRunner(
          testRunnerContext,
          Effect.suspend(() => {
            const runnerConfigured = prev.options.testRunner
            return workerSpawnOf(
              'mutationTest',
              prev.loadedPlugins,
              'TestRunner',
              configuredPluginOf(runnerConfigured),
            ).pipe(
              Effect.flatMap((resolved) =>
                makeChildProcessTestRunner({
                  options: prev.options,
                  fileDescriptions: prev.project.fileDescriptions,
                  sandboxWorkingDirectory: prev.sandbox.workingDirectory,
                  workerEntrypoint: resolved.entrypoint,
                  idGenerator: idGenerator,
                })
              ),
            )
          }),
        ),
        size: prev.concurrency.testRunners,
      })
    const reporting = yield* MutationReporting
    const sandboxFileByName: Record<string, string> = Object.fromEntries(
      yield* sandboxFilesOf(prev.sandbox, [...MutableHashMap.keys(prev.project.filesToMutate)]),
    )
    const currentRelativeFiles = yield* readCurrentRelativeFiles(prev.project, env.basePath)
    const incremental = yield* incrementalDiff({
      currentMutants: plannableMutants,
      testCoverage: prev.testCoverage,
      incrementalReport: prev.project.incrementalReport,
      currentRelativeFiles,
      basePath: env.basePath,
      force: prev.options.force,
    })
    const rememberedResults = yield* rememberedResultsOf(plannableMutants, incremental.remembered)
    yield* Effect.when(
      Effect.logInfo(
        `Incremental mode: reusing ${rememberedResults.length} mutant result(s), running ${incremental.mutants.length} mutant(s).`,
      ),
      Effect.succeed(rememberedResults.length > 0),
    )
    const { runPlans, earlyResults: noCoverageResults } = yield* partitionRunPlansEffect(
      yield* decidePlans({
        mutants: incremental.mutants,
        testCoverage: prev.testCoverage,
        options: {
          disableBail: prev.options.disableBail,
          timeoutMS: prev.options.timeoutMS,
          timeoutFactor: prev.options.timeoutFactor,
          ignoreStatic: prev.options.ignoreStatic,
        },
        timeOverheadMS: Duration.toMillis(prev.timeOverhead),
        globalTestFilter: undefined,
        sandboxFileByName,
      }),
    )
    const sortedPlans = sortRunPlans(runPlans)
    const { passedPlans, checkerResults } = yield* checkPlansWithConfiguredCheckers(
      checkerPool,
      sortedPlans,
      reporting,
    )
    const testRunnerStream = Stream.fromIterable(passedPlans)
    const plannedTotal = sortedPlans.length + noCoverageResults.length + rememberedResults.length
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
    const completedRef = yield* Ref.make(0)
    interface PreparedStreamableMutant {
      readonly status: ValidMutantStatus
      readonly file: string
      readonly location: reportSchema.Location
    }
    const preparedStreamableOf = (result: RunMutantResult) =>
      Option.match(Option.filter(Option.some(result.status), isMutantStatus), {
        onNone: () => Effect.succeed(Option.none<PreparedStreamableMutant>()),
        onSome: (status) =>
          Effect.map(
            Effect.orDie(S.decodeEffect(ReportLocationFromMutant)(result.location)),
            (location) =>
              Option.some({
                status,
                file: reportFileName(pathService.relative(env.basePath, result.fileName)),
                location,
              }),
          ),
      })
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
    const offerFinished = (result: RunMutantResult, prepared: Option.Option<PreparedStreamableMutant>) =>
      Option.match(prepared, {
        onNone: () => Effect.succeed(Option.none<number>()),
        onSome: (streamable) =>
          Effect.gen(function*() {
            const completed = yield* Ref.updateAndGet(completedRef, (n) => n + 1)
            yield* Queue.offer(
              progressQueue,
              RunMutantTested.make({
                id: result.id,
                status: streamable.status,
                file: streamable.file,
                location: streamable.location,
                mutator: result.mutatorName,
                replacement: result.replacement,
                completed,
                total: plannedTotal,
              }),
            return Option.some(completed)
          }),
      })
    const reportStreamTested = (result: RunMutantResult, completed: number, prepared: PreparedStreamableMutant) =>
      offerReporterEvent(prev.reporterStage, toStreamEvent(result, completed, prepared)).pipe(
        Effect.tapCause((cause) => Effect.logWarning('Reporter stream failed handling mutantTested', cause)),
        Effect.ignoreCause,
      )

    const offerStreamTested = (
      result: RunMutantResult,
      completed: Option.Option<number>,
      prepared: Option.Option<PreparedStreamableMutant>,
    ) =>
      Option.match(Option.all([completed, prepared]), {
        onNone: () => Effect.void,
        onSome: ([done, streamable]) => reportStreamTested(result, done, streamable),
      })
    const announceSettledMutant = (result: RunMutantResult) =>
      Effect.gen(function*() {
        const prepared = yield* preparedStreamableOf(result)
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
    yield* reporting.checkpoint(reportingInputOf(prev, env, yield* Ref.get(completedMutants))).pipe(
    const persist = (result: RunMutantResult) =>
      checkpointGate.withPermits(1)(
        Effect.gen(function*() {
          const next = yield* Ref.updateAndGet(completedMutants, (completed) => [...completed, result])
          yield* reporting.checkpoint(reportingInputOf(prev, env, next)).pipe(
            Effect.tapCause((cause) => Effect.logWarning('Failed to persist the mutation checkpoint', cause)),
            Effect.ignoreCause,
          )
        }),
      )
    const runResults = yield* withPhaseSpan(
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
                yield* Boolean.match(invalidatesRunnerPool(result.status, reasonOf(result)), {
                  onTrue: () =>
                    invalidateSlot(
                      pool,
                      runner,
                      ChildProcessCrashedError.make({
                        pid: 0,
                        exit: { _tag: 'Signal', signal: 'SIGKILL' },
                        cause: 'wall-clock timeout',
                      }),
                    ),
                  onFalse: () => Effect.void,
                })
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
    const allResults = [
      ...rememberedResults,
      ...noCoverageResults,
      ...checkerResults,
      ...runResults,
    ]
    const outcomeResult = yield* reporting.reportAll(reportingInputOf(prev, env, allResults))
    const doneNow = yield* Clock.currentTimeMillis
    const elapsed = Duration.millis(doneNow - env.runStartedAt)
    yield* Effect.logInfo(`Done in ${Duration.format(elapsed)}.`)
    return outcomeResult
  }).pipe(Effect.mapError(mapMutationTestCause))

const writeMutationTestOutcome = (
  raw: MutationTestRaw,
  outcome: Effect.Effect<MutationTestDone, StageError, StageServices>,
): Effect.Effect<MutationTestDone, StageError, StageServices> =>
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
  MutationTestDryRunOnly: (_decision, raw) => writeMutationTestOutcome(raw, writeMutationTestDryRunOnly()),
  MutationTestNoTests: (_decision, raw) => writeMutationTestOutcome(raw, writeMutationTestNoTests()),
  MutationTestProceed: (_decision, raw) => writeMutationTestOutcome(raw, writeMutationTestProceed(raw)),
  MutationTestError: ({ stage, reason }) =>
    Effect.fail(StageError.make({ stage, reason, cause: MutationTestError.make({ stage, reason }) })),
  CommandRejected: ({ issue }) => Effect.fail(StageError.make({ stage: 'mutationTest', reason: issue })),
})

const isStageError = (candidate: unknown): candidate is StageError => S.is(StageError)(candidate)

const mapMutationTestCause = (
  cause: PooledTestRunnerError | PlatformError | StageError,
): StageError =>
  Match.value({ cause }).pipe(
    Match.when({ cause: isStageError }, ({ cause }) => cause),
    Match.orElse(({ cause }) => StageError.make({ stage: 'mutationTest', reason: 'Mutation testing failed', cause })),
  )
