import type { PartialStrykerOptions } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as Path from 'effect/Path'
import type { PlatformError } from 'effect/PlatformError'
import * as Stdio from 'effect/Stdio'
import type { ResolvedMode } from './output-mode.js'
import type { MutationTestDone } from './run/mutation-test.cell.js'

import { makeRunEventStream, RunEventDrainLive } from './run-event-stream.js'

export {
  makeRunEventStream,
  type ResolvedModeInput,
  RunEventDrain,
  RunEventDrainLive,
  type RunEventStream,
} from './run-event-stream.js'
export { RunEventWireLine } from './run-event-wire.schema.js'
import * as EffectSchema from 'effect/Schema'
export { EffectSchema as S }
import { hostOptionsOf, prepareCommandOf, runOnHost } from './run-host.js'
import { makeRunLayer, mutationTestCell, RUN_EVENTS_QUEUE_BOUND, shouldKeepTempDir } from './Run.js'
import { StageError } from './Run.schema.js'

export {
  checkerDuration,
  checkerMutantsChecked,
  checkerMutantsSkipped,
  checkerProcessCrashes,
  checkerRpcFailures,
} from './metrics.js'

export type { Ignorer } from '@systemfsoftware/stryker-ignorer-interface'
export type {
  CoverageData,
  FileDescription,
  FileDescriptions,
  Location,
  Mutant,
  MutantActivation,
  MutantRunOptions,
  MutantStatus,
  MutateDescription,
  MutationRange,
  Position,
  RunMutantResult,
  RunPlan,
} from '@systemfsoftware/stryker-js-instrumenter'
export type {
  BaseTestResult,
  CheckResult,
  CompleteDryRunResult,
  CoverageAnalysis,
  DeepOptional,
  DryRunOptions,
  DryRunResult,
  ErrorDryRunResult,
  ErrorMutantRunResult,
  FailedCheckResult,
  FailedTestResult,
  FileResult,
  KilledMutantRunResult,
  Metrics,
  MetricsResult,
  MutantCoverage,
  MutantResult,
  MutantRunResult,
  MutationTestResult,
  PartialStrykerOptions,
  PassedCheckResult,
  ReporterEvent,
  ReporterFactory,
  ReporterFailed,
  ReporterInit,
  RunOptions,
  SkippedTestResult,
  StrykerOptions,
  SuccessTestResult,
  SurvivedMutantRunResult,
  TestResult,
  TestRunnerCapabilities,
  TestRunnerConfig,
  TestRunnerFailed,
  TimeoutDryRunResult,
  TimeoutMutantRunResult,
  TracedRpc,
} from '@systemfsoftware/stryker-js-plugin-interface'
export {
  CheckerCheckResult,
  CheckerFailed,
  CheckerGroupResult,
  CheckerMutantWire,
  CheckerRequest,
  CheckerRpcs,
  DryRunCompleted,
  FileResultSchema,
  LocationSchema,
  MetricsSchema,
  MutantActivationSchema,
  MutantResultSchema,
  MutantStatusSchema,
  MutantTested,
  MutationTestingPlanReady,
  MutationTestReportReady,
  MutationTestResultSchema,
  PositionSchema,
  ReporterAck,
  ReporterDrained,
  ReporterEventBatch,
  ReporterInitOptions,
  ReporterRpcs,
  StrykerOptionsSchema,
  TestRunnerConfigSchema,
  TraceContextMiddleware,
  WorkerPluginKind,
} from '@systemfsoftware/stryker-js-plugin-interface'
export { CheckerAnsweredUnrequested, CheckerSkippedRequested } from './admit-checker-answer.workflow.js'
export type { CheckerContractBroken, CheckerCrash, CheckerResourceService } from './Checker.js'
export { checkGroupedPlans } from './Checker.js'
export type { TestCoverage } from './Mutants.js'
export type {
  AnyPluginDescriptor,
  AnyWorkerPluginDescriptor,
  AnyWorkerPluginSource,
  EvaluatorPluginDescriptor,
  EvaluatorPluginSource,
  LoadedPlugins,
  PluginDescriptor,
  PluginDescriptorOf,
  PluginKind,
  PluginSource,
  WorkerPluginDescriptor,
  WorkerPluginSource,
} from './Plugins.js'
export type { Project, ProjectFile } from './Project.js'
export type { ReporterStage } from './ReporterStream.js'
export { StageError } from './Run.schema.js'
export type { DryRunDone } from './run/dry-run.cell.js'
export type { InstrumentDone } from './run/instrument.cell.js'
export type { MutationTestDone } from './run/mutation-test.cell.js'
export type { PrepareDone, PrepareExecutorArgs } from './run/prepare.cell.js'
export type { RunEnvironmentShape } from './run/RunEnvironment.js'
export { RunEnvironment } from './run/RunEnvironment.js'
export type { EnginePorts, RunStageServices, StageServices, WiredRunLayer } from './run/StageServices.js'
export type { SandboxHandle } from './Sandbox.js'
export type { StrykerRun } from './StrykerRun.js'
export type { PooledTestRunner, PooledTestRunnerError, TestRunnerBuildContext } from './TestRunner.js'
export type { IdGeneratorShape } from './Worker.js'
export { IdGenerator } from './Worker.js'
export { makeRunLayer, mutationTestCell, RUN_EVENTS_QUEUE_BOUND, shouldKeepTempDir }

export {
  Heartbeat,
  HelpRendered,
  PhaseEntered,
  PlanKnown,
  RunEvents,
  RunFailed,
  RunIdentity,
  RunMutantTested,
  RunPhase,
  RunStarted,
  VerdictReached,
} from './RunEvents.js'
export type { RunEvent, RunIdentityShape, RunTerminalEvent } from './RunEvents.js'

export { calculateMetrics, countMutants } from './calculate-metrics.js'

export { EXIT_CODE, ExitClass, highestExitClass, resolveExitCode, verdictExitClass } from './exit-classification.js'
export { buildTestRunner, isCommandRunner } from './TestRunner.js'
export { isVmRunner, VmRunner, vmRunnerCapabilities, vmRunnerName, vmTestRunner } from './VmRunner.js'
export type { VmPlatform, VmTestRunnerConfig } from './VmRunner.js'

export {
  CONFIG_SYNTAX_HELP,
  createDefaultOptions,
  deepFreeze,
  defaultOptions,
  findUnserializables,
  isModuleSpecifier,
  isWarningEnabled,
  optionsPath,
  SUPPORTED_CONFIG_FILE_NAMES,
} from './config-defaults.js'
export type {
  Immutable,
  ImmutablePrimitive,
  KnownKeys,
  Primitive,
  UnserializableDescription,
  WarningOptions,
} from './config-defaults.js'
export {
  ConfigDocumentSchema,
  ConfigError,
  ConfigFileInvalidError,
  ConfigFileNotFoundError,
  ConfigFileUnreadableError,
  ConfigFileUnsupportedError,
  extendsPropertySchema,
  ExtendsStepDocumentSchema,
  ExtendsStepDone,
  ExtendsStepRead,
  ExtendsStepRefused,
  ExtendsStepResolve,
  ExtendsStepStateSchema,
  forkOptionsSchema,
  ImportedModuleSchema,
  MergeCommand,
  MergeResult,
  ReadConfigCommand,
  survivorsPriorReport,
} from './Config.schema.js'
export type {
  ExtendsRefusalReason,
  ExtendsStepDecision,
  ExtendsStepDocument,
  ExtendsStepState,
} from './Config.schema.js'
export { createFileMatcher, matchesFile } from './file-matching.js'
export {
  decideExtendsStep,
  describeErrors,
  forkCoreSchema,
  importModule,
  initialExtendsStepState,
  loadConfigCell,
  mergeConfigs,
  readConfig,
  validateOptions,
} from './run/load-config.cell.js'
export type { ConfigInvocation, ValidationSchemaDocument } from './run/load-config.cell.js'

export type { ModeSignal, OutputMode, ResolvedMode } from './output-mode.js'

export {
  ACTIONABLE_STATUSES,
  buildVerdictEnvelope,
  generateRunId,
  isActionableStatus,
  VERDICT_ENVELOPE_SCHEMA_VERSION,
} from './verdict-envelope.js'
export type { VerdictCounts, VerdictEnvelope, VerdictMutant, VerdictThresholds } from './verdict-envelope.js'

export { toRelativeNormalizedFileName } from './IncrementalDiff.paths.js'

export { IncrementalReportSchema } from './IncrementalReport.schema.js'

export { StrykerError } from './stryker-error.schema.js'
export { classifyWorkerExit } from './Worker.js'
export { ChildProcessCrashedError, OutOfMemoryError, WorkerBootTimeoutError } from './Worker.schema.js'

export { strykerVersion } from './stryker-package.js'

export {
  REPORTER_EVENT_BATCH_BOUND,
  type ReporterWorkerClient,
  reporterWorkerFactory,
  spawnReporterWorker,
  type SpawnReporterWorkerParams,
} from './ReporterStream.js'
export { connectRetry, makeWorkerClient, WorkerLauncher } from './WorkerLauncher.js'
export type {
  SpawnedSocketWorker,
  WorkerBootError,
  WorkerClientParams,
  WorkerExit,
  WorkerLauncherShape,
  WorkerSpawnParams,
} from './WorkerLauncher.js'

const HEADLESS_MODE: ResolvedMode = { mode: 'machine', signal: 'flag', stdoutIsTTY: false }

export const strykerCell = (
  options: PartialStrykerOptions,
  targetMutatePatterns?: readonly string[],
): Effect.Effect<
  MutationTestDone,
  StageError | PlatformError,
  FileSystem.FileSystem | Path.Path | Stdio.Stdio
> =>
  Effect.gen(function*() {
    const stream = yield* makeRunEventStream(HEADLESS_MODE).pipe(
      Effect.provide(RunEventDrainLive),
    )
    const env = yield* hostOptionsOf(HEADLESS_MODE, stream, undefined)
    let patterns: string[] | undefined
    if (targetMutatePatterns !== undefined) {
      patterns = [...targetMutatePatterns]
    }
    return yield* runOnHost({ env, events: stream.queue }, prepareCommandOf(options, patterns))
  })
