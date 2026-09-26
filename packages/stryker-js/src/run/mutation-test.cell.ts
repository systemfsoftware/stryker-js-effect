import { Sandwich } from '@systemfsoftware/effect-cell-types'
import { Format, Mutant } from '@systemfsoftware/stryker-js-instrumenter'
import {
  Checker,
  Options,
  type Plugin,
  type Report,
  Reporter,
  TestRunner,
} from '@systemfsoftware/stryker-js-plugin-interface'
import * as Boolean from 'effect/Boolean'
import * as Clock from 'effect/Clock'
import * as Duration from 'effect/Duration'
import * as Effect from 'effect/Effect'
import * as Exit from 'effect/Exit'
import * as Fiber from 'effect/Fiber'
import * as FileSystem from 'effect/FileSystem'
import * as Match from 'effect/Match'
import * as Metric from 'effect/Metric'
import * as MutableHashMap from 'effect/MutableHashMap'
import * as Option from 'effect/Option'
import * as Path from 'effect/Path'
import type { PlatformError } from 'effect/PlatformError'
import * as Pool from 'effect/Pool'
import * as Queue from 'effect/Queue'
import * as Record from 'effect/Record'
import * as Ref from 'effect/Ref'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import * as Scope from 'effect/Scope'
import * as Semaphore from 'effect/Semaphore'
import * as Stream from 'effect/Stream'
import * as ChildProcessSpawner from 'effect/unstable/process/ChildProcessSpawner'

import type { CheckerContractBroken } from '../admit-checker-answer.workflow.js'
import { admitMutationTest, MutationTestError } from '../admit-mutation-test.workflow.js'
import { scoped } from '../Checker/Checker.blueprint.js'
import { checkPlans, groupPlans } from '../Checker/Checker.cell.js'
import type { CheckerCrash, CheckerResourceService } from '../Checker/Checker.handle.js'
import { CheckerMutantFromMutant, UndescribableMutant } from '../Checker/Checker.schema.js'
import {
  incrementalDiff as incrementalDiffDecisions,
  IncrementalDiffCommand,
  type IncrementalDiffDecision,
  type MutantRemembered,
} from '../incremental-diff.workflow.js'
import type { FormatIdentity } from '../IncrementalDiff.schema.js'
import { PreviousFilesSchema, PreviousTestFilesSchema } from '../IncrementalDiff.schema.js'
import { RelativeNormalizedFileName } from '../matching.schema.js'
import { UnknownPlannedMutant } from '../MutantsError.schema.js'
import { MutantTestPlanCommand } from '../MutantTestPlanCommand.schema.js'
import { identityOf, MutationReporting } from '../mutation-reporting.service.js'
import type { MutationReportingInput, MutationReportingService } from '../mutation-reporting.service.js'
import { MutationTestCommand } from '../MutationTest.schema.js'
import { planMutantTests, type PlannedEarlyResultMutant, type PlannedRunMutant } from '../plan-mutant-tests.workflow.js'
import type { LoadedPlugins } from '../Plugins.schema.js'
import { PluginNotFoundError } from '../PluginsError.schema.js'
import { invalidatesRunnerPool, type PooledTestRunner } from '../pooled-test-runner.handle.js'
import { ProjectFiles } from '../project-files.service.js'
import type { Project } from '../Project.schema.js'
import { offerReporterEvent, withPhaseSpan } from '../reporter-stream.service.js'
import { ReportFileName } from '../reporting/report-assembly.schema.js'
import { PlanKnown, RunEvents, RunMutantTested } from '../run-events.service.js'
import { StageError } from '../Run.schema.js'
import { sandboxFileFor, type SandboxHandle } from '../Sandbox.handle.js'
import type { TestCoverage } from '../test-coverage.schema.js'
import { buildTestRunner, makeChildProcessTestRunner } from '../TestRunner.blueprint.js'
import type { PooledTestRunnerError } from '../TestRunner.schema.js'
import { testRunnerConfigOf } from '../vm-runner.js'
import { ChildProcessCrashedError } from '../Worker.schema.js'
import { IdGenerator } from '../Worker.service.js'
import { WorkerLauncher } from '../WorkerLauncher.service.js'
import type { DryRunDone } from './dry-run.cell.js'
import {
  ConfiguredPluginModulePath,
  ConfiguredPluginName,
  resolveConfiguredPlugin,
  WorkerSpawnCommand,
  type WorkerSpawnResolved,
} from './resolve-configured-plugin.workflow.js'
import { phaseEntered, RunEnvironment, type RunEnvironmentShape } from './RunEnvironment.service.js'
import type { StageServices } from './StageServices.service.js'

export interface MutationTestDone {
  readonly results: readonly Mutant.RunMutantResult[]
  readonly verdict: Plugin.ExitClass | null
}

const relativeFileNameOf = (fileName: string, basePath: string) =>
  RelativeNormalizedFileName.fromAbsolute(fileName, basePath).fileName

const readCurrentRelativeFiles = Effect.fn('stryker.mutation_test.read_relative_files')(function*(
  project: Project,
  basePath: string,
) {
  const projectFiles = yield* ProjectFiles
  const entries = yield* projectFiles.readAllOriginal(MutableHashMap.values(project.files))
  return Object.fromEntries(
    entries.map(([file, content]) => [relativeFileNameOf(file.name, basePath), content] as const),
  )
})

const reportingInputOf = (
  prev: DryRunDone,
  env: RunEnvironmentShape,
  results: readonly Mutant.RunMutantResult[],
): MutationReportingInput => ({
  results,
  options: prev.options,
  project: prev.project,
  testCoverage: prev.testCoverage,
  runId: env.runId,
  resolvedMode: env.resolvedMode,
  basePath: env.basePath,
  reporterStage: prev.reporterStage,
  formatRegistry: prev.formatRegistry,
})

const sandboxFilePairsOf = (sandbox: SandboxHandle, fileNames: readonly string[]) =>
  Result.all(
    fileNames.map((fileName) =>
      Result.map(
        sandboxFileFor(sandbox, fileName),
        (sandboxFileName): readonly [string, string] => [fileName, sandboxFileName],
      )
    ),
  )

const sandboxFilesOf = Effect.fn('stryker.mutation_test.sandbox_files')(function*(
  sandbox: SandboxHandle,
  fileNames: readonly string[],
) {
  return yield* Effect.fromResult(sandboxFilePairsOf(sandbox, fileNames)).pipe(
    Effect.mapError((cause) =>
      StageError.make({ stage: 'mutationTest', reason: 'Failed to resolve sandbox file', cause })
    ),
  )
})

type RememberedMutantResult = MutantRemembered

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

const rememberedStatusOf = (entry: RememberedMutantResult) =>
  S.decodeUnknownEffect(Mutant.MutantStatusSchema)(entry.status)

const rememberedResultOf = (
  mutant: Mutant.Mutant,
  entry: RememberedMutantResult,
  reportLocation: Mutant.Location,
  status: Mutant.MutantStatus,
): Mutant.RunMutantResult =>
  Object.assign(
    {},
    mutant,
    {
      location: reportLocation,
      status,
      statusReason: REMEMBERED_REASON,
      testsCompleted: entry.testsCompleted,
    },
    rememberedCoverage(entry),
  )

const mutantsByIdOf = (mutants: ReadonlyArray<Mutant.Mutant>) =>
  new Map(mutants.map((mutant) => [mutant.id, mutant] as const))

const rememberedOf = (mutant: Mutant.Mutant, entry: RememberedMutantResult) =>
  Effect.map(
    Effect.all([
      Effect.orDie(S.decodeEffect(Mutant.ReportLocationFromMutant)(mutant.location)),
      rememberedStatusOf(entry).pipe(Effect.orDie),
    ]),
    ([reportLocation, status]) => rememberedResultOf(mutant, entry, reportLocation, status),
  )

const rememberedResultsOf = Effect.fn('stryker.mutation_test.remembered_results')(function*(
  mutants: readonly Mutant.Mutant[],
  remembered: readonly RememberedMutantResult[],
) {
  const byId = mutantsByIdOf(mutants)
  const located = yield* Effect.forEach(
    remembered,
    (entry) =>
      Option.match(Option.fromUndefinedOr(byId.get(entry.mutantId)), {
        onNone: () => Effect.succeed(Option.none<Mutant.RunMutantResult>()),
        onSome: (mutant) => Effect.asSome(rememberedOf(mutant, entry)),
      }),
  )
  return located.flatMap((entry) => Option.match(entry, { onNone: () => [], onSome: (result) => [result] }))
})

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
  VALID_MUTANT_STATUSES.some((status) => status === candidate)

const toReportedMutant = (mutant: Mutant.Mutant): Mutant.MutantTestCoverage =>
  Object.assign(mutant, { coveredBy: mutant.coveredBy, static: mutant.static })

type CheckerSlot = {
  readonly checkerName: string
  readonly checker: CheckerResourceService
}[]

const CHECKER_ACQUIRE_RETRIES = 2

const TEST_RUNNER_POOL_IDLE_TIME_TO_LIVE = Duration.minutes(1)

const isCheckerCrash = (error: StageError | CheckerCrash): boolean =>
  Match.value(error).pipe(
    Match.tag('ChildProcessCrashedError', 'OutOfMemoryError', () => true),
    Match.orElse(() => false),
  )

const configuredPluginOf = (configured: string | { readonly plugin: string }) =>
  Match.value(testRunnerConfigOf(configured)).pipe(
    Match.when(Options.isCustomTestRunner, (custom) => ConfiguredPluginModulePath.make({ modulePath: custom.plugin })),
    Match.orElse((name) => ConfiguredPluginName.make({ name })),
  )

const workerSpawnOf = (
  stage: StageError['stage'],
  loaded: Pick<LoadedPlugins, 'pluginSources'>,
  kind: Plugin.WorkerPluginKind,
  configured: ConfiguredPluginName | ConfiguredPluginModulePath,
): Effect.Effect<WorkerSpawnResolved, StageError> =>
  Effect.mapError(
    Effect.fromResult(
      resolveConfiguredPlugin(WorkerSpawnCommand.make({ sources: loaded.pluginSources, kind, configured })),
    ),
    (missing) =>
      StageError.make({
        stage,
        reason: missing.reason,
        cause: PluginNotFoundError.make({ descriptor: missing.descriptor }),
      }),
  )

const calculateTotalTime = (testResults: Iterable<TestRunner.TestResult>) =>
  [...testResults].reduce((acc, test) => acc + test.timeSpentMs, 0)

const toTestIds = (testResults: Iterable<TestRunner.TestResult>) => [...testResults].map((test) => test.id)

const hitsRecordOf = (testCoverage: TestCoverage) => Object.fromEntries(testCoverage.hitsByMutantId)

const testsByMutantIdRecordOf = (testCoverage: TestCoverage) =>
  Object.fromEntries(
    [...testCoverage.testsByMutantId].map(([mutantId, tests]) => [mutantId, toTestIds(tests)] as const),
  )

const testTimeRecordOf = (testCoverage: TestCoverage) =>
  Object.fromEntries([...testCoverage.testsById].map(([id, result]) => [id, result.timeSpentMs] as const))

const planCommandOf = (
  mutants: readonly Mutant.Mutant[],
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
    timeSpentAllTests: testCoverage.testsById.pipe(MutableHashMap.values, calculateTotalTime),
    hitsByMutantId: hitsRecordOf(testCoverage),
    testsByMutantId: testsByMutantIdRecordOf(testCoverage),
    testTimeById: testTimeRecordOf(testCoverage),
    options,
    sandboxFileByName,
    ...Option.match(Option.fromNullishOr(testCoverage.staticCoverage), {
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
  original: Mutant.Mutant,
  decided: {
    readonly status?: Mutant.Mutant['status'] | undefined
    readonly statusReason?: string | undefined
    readonly static?: boolean | undefined
    readonly coveredBy?: readonly string[] | undefined
  },
) =>
  Mutant.Mutant.make({
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

const plannedRunOf = (mutant: Mutant.Mutant, run: PlannedRunMutant): Mutant.RunPlan => ({
  plan: 'Run',
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
})

const plannedEarlyOf = (mutant: Mutant.Mutant, early: PlannedEarlyResultMutant): Mutant.EarlyResultPlan => ({
  plan: 'EarlyResult',
  mutant: materializeMutant(mutant, early),
})

const decidePlans = Effect.fn('stryker.mutation_test.decide_plans')(function*(
  input: Readonly<{
    mutants: readonly Mutant.Mutant[]
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
) {
  const command = planCommandOf(
    input.mutants,
    input.testCoverage,
    input.options,
    input.timeOverheadMS,
    input.globalTestFilter,
    input.sandboxFileByName,
  )
  const byId = mutantsByIdOf(input.mutants)
  return yield* Result.match(planMutantTests(command), {
    onFailure: (failure) =>
      Effect.fail(
        StageError.make({
          stage: 'mutationTest',
          reason: `covered mutant missing dry-run hit count: ${failure.missingIds.join(', ')}`,
          cause: failure,
        }),
      ),
    onSuccess: (decisions) =>
      Effect.forEach(decisions, (plan) =>
        Option.match(Option.fromUndefinedOr(byId.get(plan.mutantId)), {
          onNone: () =>
            Effect.die(UnknownPlannedMutant.make({
              mutantId: plan.mutantId,
              message: `planner returned an unknown mutant id: ${plan.mutantId}`,
            })),
          onSome: (mutant) =>
            Match.value(plan).pipe(
              Match.tag('PlannedRunMutant', (run) => Effect.succeed(plannedRunOf(mutant, run))),
              Match.tag('PlannedEarlyResultMutant', (early) => Effect.succeed(plannedEarlyOf(mutant, early))),
              Match.exhaustive,
            ),
        })),
  })
})

const earlyResultStatusOf = (mutant: Mutant.Mutant) =>
  Option.getOrElse(Option.fromUndefinedOr(mutant.status), () => 'Ignored' as const)

const earlyResultOf = Effect.fn('stryker.mutation_test.early_result')(function*(
  plan: Mutant.EarlyResultPlan,
) {
  const reportLocation = yield* Effect.orDie(S.decodeEffect(Mutant.ReportLocationFromMutant)(plan.mutant.location))
  return Object.assign({}, plan.mutant, {
    location: reportLocation,
    status: earlyResultStatusOf(plan.mutant),
  })
})

const partitionRunPlans = (plans: readonly Mutant.TestPlan[]) => ({
  runPlans: plans.filter((plan): plan is Mutant.RunPlan => plan.plan === 'Run'),
  earlyPlans: plans.filter((plan): plan is Mutant.EarlyResultPlan => plan.plan === 'EarlyResult'),
})

const sortRunPlans = (plans: readonly Mutant.RunPlan[]): readonly Mutant.RunPlan[] =>
  [...plans].sort(
    (left, right) => Number(left.runOptions.reloadEnvironment) - Number(right.runOptions.reloadEnvironment),
  )

const previousFilesOf = (report: Report.MutationTestResult | undefined): S.Schema.Type<typeof PreviousFilesSchema> =>
  Option.getOrElse(
    Option.flatMap(
      Option.fromUndefinedOr(report),
      (present) => S.decodeUnknownOption(PreviousFilesSchema)(present.files),
    ),
    (): S.Schema.Type<typeof PreviousFilesSchema> => ({}),
  )

const previousTestFilesOf = (
  report: Report.MutationTestResult | undefined,
): S.Schema.Type<typeof PreviousTestFilesSchema> =>
  Option.getOrElse(
    Option.flatMap(
      Option.flatMap(Option.fromUndefinedOr(report), (present) => Option.fromUndefinedOr(present.testFiles)),
      (testFiles) => S.decodeOption(PreviousTestFilesSchema)(testFiles),
    ),
    (): S.Schema.Type<typeof PreviousTestFilesSchema> => ({}),
  )

type LocatedTestResult = TestRunner.TestResult & { readonly fileName: string }

const hasTestFileName = (result: TestRunner.TestResult): result is LocatedTestResult => result.fileName !== undefined

const relativeFileOfTest = (result: LocatedTestResult, basePath: string) =>
  RelativeNormalizedFileName.fromAbsolute(result.fileName, basePath).fileName

const claimedIdentities = (
  project: Project,
  registry: Format.FormatRegistry,
  basePath: string,
): Record<string, FormatIdentity> =>
  Object.fromEntries(
    [...MutableHashMap.keys(project.filesToMutate)].flatMap((name) =>
      Option.match(identityOf(name, registry), {
        onNone: (): ReadonlyArray<readonly [string, FormatIdentity]> => [],
        onSome: (identity) => [[relativeFileNameOf(name, basePath), identity] as const],
      })
    ),
  )

const testIdsByRelativeFileOf = (testCoverage: TestCoverage, basePath: string) =>
  [...MutableHashMap.values(testCoverage.testsById)].filter(hasTestFileName).reduce<Record<string, string[]>>(
    (accumulator, result) => {
      const file = relativeFileOfTest(result, basePath)
      const ids = Option.getOrElse(Record.get(accumulator, file), (): string[] => [])
      return { ...accumulator, [file]: [...ids, result.id] }
    },
    {},
  )

const coveredFilesOfTests = (
  tests: Iterable<LocatedTestResult>,
  basePath: string,
) => [...new Set([...tests].map((result) => relativeFileOfTest(result, basePath)))]

const coveringTestFilesByMutantIdOf = (testCoverage: TestCoverage, basePath: string) =>
  Object.fromEntries(
    [...testCoverage.testsByMutantId].map(([mutantId, tests]) =>
      [mutantId, coveredFilesOfTests([...tests].filter(hasTestFileName), basePath)] as const
    ),
  )

const relativeFileByMutantIdOf = (mutants: readonly Mutant.Mutant[], basePath: string) =>
  Object.fromEntries(
    mutants.map((mutant) => [mutant.id, relativeFileNameOf(mutant.fileName, basePath)] as const),
  )

const incrementalDiffCommandOf = (
  currentMutants: readonly Mutant.Mutant[],
  testCoverage: TestCoverage,
  incrementalReport: Report.MutationTestResult | undefined,
  currentRelativeFiles: Record<string, string>,
  basePath: string,
  force: boolean,
  identitiesByFile: Record<string, FormatIdentity>,
) =>
  IncrementalDiffCommand.make({
    currentMutants: [...currentMutants],
    relativeFileByMutantId: relativeFileByMutantIdOf(currentMutants, basePath),
    previousFiles: previousFilesOf(incrementalReport),
    previousTestFiles: previousTestFilesOf(incrementalReport),
    currentRelativeFiles,
    testIdsByRelativeFile: testIdsByRelativeFileOf(testCoverage, basePath),
    coveringTestFilesByMutantId: coveringTestFilesByMutantIdOf(testCoverage, basePath),
    identitiesByFile,
    force,
  })

const incrementalDiff = Effect.fn('stryker.mutation_test.incremental_diff')(function*(
  input: Readonly<{
    currentMutants: readonly Mutant.Mutant[]
    testCoverage: TestCoverage
    incrementalReport: Report.MutationTestResult | undefined
    currentRelativeFiles: Record<string, string>
    basePath: string
    force?: boolean
    identitiesByFile: Record<string, FormatIdentity>
  }>,
) {
  const command = incrementalDiffCommandOf(
    input.currentMutants,
    input.testCoverage,
    input.incrementalReport,
    input.currentRelativeFiles,
    input.basePath,
    input.force ?? false,
    input.identitiesByFile,
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
    Match.tag('MutantRemembered', (remembered) => [remembered] as const),
    Match.exhaustive,
  )

const makeCheckerPool = Effect.fnUntraced(function*(
  prev: DryRunDone,
  projectDirectory: string,
) {
  return yield* Match.value(prev.options.checkers.length === 0).pipe(
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
})

interface CheckedPlans {
  readonly passedPlans: readonly Mutant.MutantRunPlan[]
  readonly checkerResults: readonly Mutant.RunMutantResult[]
}

const checkerBreachToStageError = (error: CheckerContractBroken | Checker.CheckerFailed): StageError =>
  Match.value(error).pipe(
    Match.tag(
      'CheckerFailed',
      (failed) => StageError.make({ stage: 'mutationTest', reason: failed.cause, cause: failed }),
    ),
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
): Effect.Effect<never, E> => Effect.flatMap(Pool.invalidate(pool, slot), () => Effect.fail(error))

type CheckerPool = Pool.Pool<CheckerSlot, StageError | CheckerCrash>

const onCheckerSlot = <A>(
  pool: CheckerPool,
  checkerIndex: number,
  run: (
    checker: CheckerResourceService,
  ) => Effect.Effect<A, CheckerCrash | Checker.CheckerFailed | CheckerContractBroken>,
): Effect.Effect<A, StageError | CheckerCrash> =>
  Pool.use(pool, (slot) =>
    Option.match(Option.fromUndefinedOr(slot[checkerIndex]), {
      onNone: () => Effect.die(new Error(`checker slot has no entry at index ${checkerIndex}`)),
      onSome: ({ checker }) =>
        run(checker).pipe(
          Effect.catchTags({
            OutOfMemoryError: (error) => invalidateSlot(pool, slot, error),
            ChildProcessCrashedError: (error) => invalidateSlot(pool, slot, error),
            CheckerFailed: (error) => error.pipe(checkerBreachToStageError, Effect.fail),
            CheckerAnsweredUnrequested: (error) => error.pipe(checkerBreachToStageError, Effect.fail),
            CheckerSkippedRequested: (error) => error.pipe(checkerBreachToStageError, Effect.fail),
          }),
        ),
    }))

const checkGroupsConcurrently = (
  pool: CheckerPool,
  checkerIndex: number,
  checkerName: string,
  currentPlans: readonly Mutant.MutantRunPlan[],
): Effect.Effect<
  readonly (readonly [Mutant.MutantRunPlan, Checker.CheckResult])[],
  StageError | CheckerCrash
> =>
  Effect.flatMap(
    onCheckerSlot(pool, checkerIndex, (checker) => groupPlans(checker, checkerName, currentPlans)),
    (groups) =>
      Effect.map(
        Effect.forEach(
          groups,
          (group) => onCheckerSlot(pool, checkerIndex, (checker) => checkPlans(checker, checkerName, group)),
          { concurrency: 'unbounded' },
        ),
        (perGroup) => perGroup.flat(),
      ),
  )

const isFailedCheck = (
  check: readonly [Mutant.MutantRunPlan, Checker.CheckResult],
): check is readonly [Mutant.MutantRunPlan, Checker.FailedCheckResult] => check[1].status !== 'passed'

const splitCheckedPlans = (
  checked: readonly (readonly [Mutant.MutantRunPlan, Checker.CheckResult])[],
  reporting: MutationReportingService,
) => {
  const failures = checked.filter(isFailedCheck)
  const passed = checked.filter(([plan, result]) => !isFailedCheck([plan, result])).map(([plan]) => plan)
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
  pool: CheckerPool,
  checkerIndex: number,
  checkerName: string,
  currentPlans: readonly Mutant.MutantRunPlan[],
  reporting: MutationReportingService,
) =>
  checkGroupsConcurrently(pool, checkerIndex, checkerName, currentPlans).pipe(
    Effect.flatMap((checked) => splitCheckedPlans(checked, reporting)),
  )

const emptyRunResults: readonly Mutant.RunMutantResult[] = []

const runConfiguredCheckers = (
  pool: CheckerPool,
  plans: readonly Mutant.MutantRunPlan[],
  reporting: MutationReportingService,
): Effect.Effect<CheckedPlans, StageError | CheckerCrash> =>
  Effect.flatMap(
    Pool.use(pool, (slot) => Effect.succeed(slot.map(({ checkerName }) => checkerName))),
    (checkerNames) =>
      Effect.reduce(
        checkerNames,
        () => ({ passedPlans: plans, checkerResults: emptyRunResults }),
        (acc, checkerName, checkerIndex) =>
          Effect.map(
            stepOneChecker(pool, checkerIndex, checkerName, acc.passedPlans, reporting),
            (split) => ({
              passedPlans: split.passed,
              checkerResults: [...acc.checkerResults, ...split.results],
            }),
          ),
      ),
  )

const checkPlansWithConfiguredCheckers = (
  checkerPool: CheckerPool | undefined,
  plans: readonly Mutant.MutantRunPlan[],
  reporting: MutationReportingService,
) =>
  Option.match(Option.fromNullishOr(checkerPool), {
    onNone: () => Effect.succeed({ passedPlans: plans, checkerResults: emptyRunResults }),
    onSome: (pool) => runConfiguredCheckers(pool, plans, reporting),
  })

const checkerResourcesInOwnScope = Effect.fn('stryker.mutation_test.checker_scope')(function*(
  acquire: Effect.Effect<
    CheckerPool | undefined,
    never,
    Scope.Scope | ChildProcessSpawner.ChildProcessSpawner | WorkerLauncher | FileSystem.FileSystem | Path.Path
  >,
) {
  const checkerScope = yield* Scope.make()
  yield* Effect.addFinalizer(() => Scope.close(checkerScope, Exit.void))
  const resources = yield* acquire.pipe(Scope.provide(checkerScope))
  return {
    resources,
    releaseInBackground: Scope.close(checkerScope, Exit.void).pipe(Effect.forkScoped({ uninterruptible: true })),
  }
})

const isPlannable = (mutant: Mutant.Mutant): boolean =>
  Result.isSuccess(S.decodeResult(CheckerMutantFromMutant)(mutant))

const DROPPED_IDS_IN_WARNING = 5

const configuredTestFilesOf = (run: {
  readonly options: { readonly testFiles: readonly string[] }
  readonly project: { readonly testFiles: readonly string[] }
}): readonly string[] => run.options.testFiles.length === 0 ? [] : run.project.testFiles

const partitionPlannable = (mutants: readonly Mutant.Mutant[]) => ({
  plannable: mutants.filter(isPlannable),
  dropped: mutants.filter((candidate) => !isPlannable(candidate)),
})

const droppedIdsOf = (dropped: readonly Mutant.Mutant[]): string =>
  `${dropped.slice(0, DROPPED_IDS_IN_WARNING).map((mutant) => mutant.id).join(', ')}${
    Option.match(Option.liftPredicate(dropped.length, (count) => count > DROPPED_IDS_IN_WARNING), {
      onNone: () => '',
      onSome: (count) => `, +${count - DROPPED_IDS_IN_WARNING} more`,
    })
  }`

const reportDroppedMutants = (dropped: readonly Mutant.Mutant[]) =>
  Match.value(dropped.length).pipe(
    Match.when(0, () => Effect.void),
    Match.orElse(() =>
      Effect.gen(function*() {
        yield* Metric.update(UndescribableMutant.skipped, dropped.length)
        yield* Effect.logWarning(
          `${dropped.length} mutant(s) cannot be described to a checker and were left out of the run (${
            droppedIdsOf(dropped)
          })`,
        )
      })
    ),
  )

const reasonOf = (result: { readonly status: string; readonly reason?: string }): string | undefined =>
  Match.value(result).pipe(
    Match.when({ status: 'timeout' }, (timedOut) => timedOut.reason),
    Match.orElse(() => undefined),
  )

const stopWallClock = (
  result: { readonly status: string; readonly reason?: string },
): Effect.Effect<void, StageError> =>
  Boolean.match(result.status === 'timeout' && !S.is(TestRunner.HitLimitReasonText)(reasonOf(result)), {
    onTrue: () =>
      Effect.fail(StageError.make({ stage: 'mutationTest', reason: TestRunner.WallClockTimeoutReason.literal })),
    onFalse: () => Effect.void,
  })

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
  const scopedCheckers = yield* checkerResourcesInOwnScope(makeCheckerPool(prev, env.basePath))
  const testFiles = yield* Effect.map(
    sandboxFilesOf(prev.sandbox, configuredTestFilesOf(prev)),
    (pairs) => pairs.map(([, sandboxFileName]) => sandboxFileName),
  )
  const testRunnerPool: Pool.Pool<PooledTestRunner, StageError | PooledTestRunnerError> = yield* Pool
    .makeWithTTL({
      acquire: buildTestRunner(
        {
          options: prev.options,
          fileDescriptions: prev.project.fileDescriptions,
          sandboxWorkingDirectory: prev.sandbox.workingDirectory,
          idGenerator: idGenerator,
          retire: Effect.void,
          testFiles,
        },
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
      min: prev.concurrency.testRunners,
      max: testRunnerCapacity,
      timeToLive: TEST_RUNNER_POOL_IDLE_TIME_TO_LIVE,
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
    identitiesByFile: claimedIdentities(prev.project, prev.formatRegistry, env.basePath),
  })
  const rememberedResults = yield* rememberedResultsOf(plannableMutants, incremental.remembered)
  yield* Effect.when(
    Effect.logInfo(
      `Incremental mode: reusing ${rememberedResults.length} mutant result(s), running ${incremental.mutants.length} mutant(s).`,
    ),
    Effect.succeed(rememberedResults.length > 0),
  )
  const { runPlans, earlyPlans } = partitionRunPlans(
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
  const noCoverageResults = yield* Effect.forEach(earlyPlans, (plan) => earlyResultOf(plan))
  const sortedPlans = sortRunPlans(runPlans)
  const allPlansForReporter: readonly Mutant.RunPlan[] = [...sortedPlans]
  yield* offerReporterEvent(
    prev.reporterStage,
    Reporter.MutationTestingPlanReady.make({
      total: allPlansForReporter.length + noCoverageResults.length + rememberedResults.length,
      plans: allPlansForReporter.map((plan) => ({
        mutantId: plan.mutant.id,
        plan: plan.plan,
        netTime: plan.netTime,
        reloadEnvironment: plan.runOptions.reloadEnvironment,
      })),
    }),
  ).pipe(Effect.ignoreCause)
  const progressQueue = yield* RunEvents
  yield* Queue.offer(progressQueue, PlanKnown.make({ total: allPlansForReporter.length + noCoverageResults.length }))
  const { passedPlans, checkerResults } = yield* checkPlansWithConfiguredCheckers(
    scopedCheckers.resources,
    sortedPlans,
    reporting,
  )
  const checkerRelease = yield* scopedCheckers.releaseInBackground
  const testRunnerStream = Stream.fromIterable(passedPlans)
  const plannedTotal = sortedPlans.length + noCoverageResults.length + rememberedResults.length
  const completedRef = yield* Ref.make(0)
  const pathService = yield* Path.Path
  interface PreparedStreamableMutant {
    readonly status: ValidMutantStatus
    readonly file: string
    readonly location: Mutant.Location
  }
  const preparedStreamableOf = (result: Mutant.RunMutantResult) =>
    Option.match(Option.filter(Option.some(result.status), isMutantStatus), {
      onNone: () => Effect.succeed(Option.none<PreparedStreamableMutant>()),
      onSome: (status) =>
        Effect.map(
          Effect.all([
            Effect.orDie(S.decodeEffect(Mutant.ReportLocationFromMutant)(result.location)),
            Effect.orDie(S.decodeEffect(ReportFileName)(pathService.relative(env.basePath, result.fileName))),
          ]),
          ([location, file]) => Option.some({ status, file, location }),
        ),
    })
  const toStreamEvent = (
    result: Mutant.RunMutantResult,
    completed: number,
    prepared: PreparedStreamableMutant,
  ): Reporter.MutantTested =>
    Reporter.MutantTested.make({
      id: result.id,
      status: prepared.status,
      file: prepared.file,
      location: prepared.location,
      mutator: result.mutatorName,
      replacement: result.replacement,
      completed,
      total: plannedTotal,
    })
  const offerFinished = (result: Mutant.RunMutantResult, prepared: Option.Option<PreparedStreamableMutant>) =>
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
          )
          return Option.some(completed)
        }),
    })
  const reportStreamTested = (
    result: Mutant.RunMutantResult,
    completed: number,
    prepared: PreparedStreamableMutant,
  ) =>
    offerReporterEvent(prev.reporterStage, toStreamEvent(result, completed, prepared)).pipe(
      Effect.tapCause((cause) => Effect.logWarning('Reporter stream failed handling mutantTested', cause)),
      Effect.ignoreCause,
    )

  const offerStreamTested = (
    result: Mutant.RunMutantResult,
    completed: Option.Option<number>,
    prepared: Option.Option<PreparedStreamableMutant>,
  ) =>
    Option.match(Option.all([completed, prepared]), {
      onNone: () => Effect.void,
      onSome: ([done, streamable]) => reportStreamTested(result, done, streamable),
    })
  const announceSettledMutant = (result: Mutant.RunMutantResult) =>
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
  const completedMutants = yield* Ref.make<Mutant.RunMutantResult[]>([
    ...rememberedResults,
    ...noCoverageResults,
    ...checkerResults,
  ])
  const checkpointGate = yield* Semaphore.make(1)
  yield* reporting.checkpoint(reportingInputOf(prev, env, yield* Ref.get(completedMutants))).pipe(
    Effect.tapCause((cause) => Effect.logWarning('Failed to persist the mutation checkpoint', cause)),
    Effect.ignoreCause,
  )
  const persist = (result: Mutant.RunMutantResult) =>
    checkpointGate.withPermits(1)(
      Effect.gen(function*() {
        const next = yield* Ref.updateAndGet(completedMutants, (completed) => [...completed, result])
        yield* reporting.checkpoint(reportingInputOf(prev, env, next)).pipe(
          Effect.tapCause((cause) => Effect.logWarning('Failed to persist the mutation checkpoint', cause)),
          Effect.ignoreCause,
        )
      }),
    )
  const runOnePlan = Effect.fn('stryker.mutation_test.run_mutant')(function*(plan: Mutant.MutantRunPlan) {
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
    yield* Boolean.match(invalidatesRunnerPool(result.status, reasonOf(result)), {
      onTrue: () =>
        invalidateSlot(
          testRunnerPool,
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
    const prepared = yield* preparedStreamableOf(reported)
    const finished = yield* offerFinished(reported, prepared)
    yield* offerStreamTested(reported, finished, prepared)
    yield* persist(reported)
    return reported
  })
  const runResults = yield* withPhaseSpan(
    'mutationTest.batch',
    { total: plannedTotal, testRunners: prev.concurrency.testRunners },
    () =>
      Stream.mapEffect(testRunnerStream, (plan) => Effect.scoped(runOnePlan(plan)), {
        concurrency: Math.max(1, testRunnerCapacity),
      }).pipe(
        Stream.runFold(
          (): readonly Mutant.RunMutantResult[] => emptyRunResults,
          (acc, result) => [...acc, result],
        ),
      ),
  )
  const allResults = [
    ...rememberedResults,
    ...noCoverageResults,
    ...checkerResults,
    ...runResults,
  ]
  const outcomeResult = yield* reporting.reportAll(reportingInputOf(prev, env, allResults))
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
