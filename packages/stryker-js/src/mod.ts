export {
  makeRunEventStream,
  type ResolvedModeInput,
  RunEventDrain,
  RunEventDrainLive,
  type RunEventStream,
} from './run-event-stream.service.js'
export { RunEventWireLine } from './run-event-wire.schema.js'
import * as EffectSchema from 'effect/Schema'
export { EffectSchema as S }

export { MetricsResultFromReport } from './reporting/metrics-from-report.schema.js'

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
export { CheckerAnsweredUnrequested, CheckerSkippedRequested } from './Checker/mod.js'
export type { CheckerContractBroken, CheckerCrash, CheckerResourceService } from './Checker/mod.js'
export { checkGroupedPlans } from './Checker/mod.js'
export type { TestCoverage } from './test-coverage.schema.js'
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
} from './Plugins.schema.js'
export type { Project, ProjectFile } from './Project.schema.js'
export type { ReporterStage } from './reporter-stream.service.js'
export { StageError } from './Run.schema.js'
export type { DryRunDone } from './run/dry-run.cell.js'
export type { InstrumentDone } from './run/instrument.cell.js'
export type { MutationTestDone } from './run/mutation-test.cell.js'
export type { PrepareDone, PrepareExecutorArgs } from './run/prepare.cell.js'
export type { RunEnvironmentShape } from './run/RunEnvironment.service.js'
export { RunEnvironment } from './run/RunEnvironment.service.js'
export type { EnginePorts, RunStageServices, StageServices, WiredRunLayer } from './run/StageServices.service.js'
export type { SandboxHandle } from './Sandbox.handle.js'
export type {
  isPooledTestRunner,
  PooledTestRunner,
  TypeId as PooledTestRunnerTypeId,
} from './pooled-test-runner.handle.js'
export {
  invalidatesRunnerPool,
  withEnvironmentReload,
  withMaxReuse,
  withRetry,
  withTimeout,
} from './pooled-test-runner.handle.js'
export type { TestRunnerBuildContext } from './TestRunner.resource.js'
export type { PooledTestRunnerError } from './TestRunner.schema.js'
export type { VmRequire } from './VmRunner.service.js'
export type { IdGeneratorShape } from './Worker.service.js'
export { IdGenerator } from './Worker.service.js'
export { keepTempDir, KeepTempDirCommand, type KeepTempDirOption, type KeepTempDirOutcome, TempDirKept, TempDirRemoved } from './keep-temp-dir.workflow.js'
export type { HostServices, StrykerRun } from './run/host.service.js'
export { mutationTestCell, strykerCell } from './run/run-stages.cell.js'

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
} from './run-events.service.js'
export type { RunEvent, RunIdentityShape, RunTerminalEvent } from './run-events.service.js'

export { ExitClass, ExitCodeFromClass } from '@systemfsoftware/stryker-js-plugin-interface'
export {
  classifyExit,
  ClassifyExitCommand,
  ClassifyExitDecision,
  ExitConfigErrored,
  ExitInternalErrored,
  ExitPassed,
  ExitRuntimeErrored,
  ExitVerdictFailed,
} from './classify-exit.workflow.js'
export {
  classifyWorkerExit,
  ClassifyWorkerExitCommand,
  ClassifyWorkerExitDecision,
  WorkerCrashed,
  WorkerOutOfMemory,
} from './classify-worker-exit.workflow.js'
export { buildTestRunner } from './TestRunner.resource.js'
export { isCommandRunner } from './command-runner.resource.js'
export { isVmRunner, vmTestRunner } from './VmRunner.resource.js'
export type { CompiledTests, VmTestRunnerConfig } from './VmRunner.resource.js'
export { VmRunner } from './VmRunner.service.js'
export type { VmModule, VmModuleBuiltin, VmPlatform, VmScript } from './VmRunner.service.js'

export { StrykerConfig } from './config/stryker-config.schema.js'
export type {
  ConfigEnv,
  Immutable,
  ImmutablePrimitive,
  Primitive,
  StrykerConfigExport,
  StrykerConfigFn,
} from './config/stryker-config.schema.js'
export { ConfigDocumentSchema } from './Config.schema.js'
export {
  ConfigError,
  ConfigFileInvalidError,
  ConfigFileNotFoundError,
  ConfigFileUnreadableError,
  ConfigFileUnsupportedError,
} from './ConfigError.schema.js'
export {
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
export type { ConfigInvocation, LoadedConfig, ValidationSchemaDocument } from './run/load-config.cell.js'
export type { ModeSignal, OutputMode, ResolvedMode } from './output-mode.schema.js'

export {
  ActionableStatus,
  RunId,
  VerdictEnvelope,
  VerdictMutant,
  VerdictThresholds,
} from './reporting/verdict-envelope.schema.js'
export type { VerdictCounts } from './reporting/verdict-envelope.schema.js'

export { IncrementalReportSchema } from './IncrementalReport.schema.js'

export { StrykerError } from './stryker-error.schema.js'
export type { WorkerBootError, WorkerExit } from './Worker.schema.js'
export { ChildProcessCrashedError, OutOfMemoryError, WorkerBootTimeoutError } from './Worker.schema.js'

export { StrykerPackage } from './stryker-package.schema.js'

export {
  REPORTER_EVENT_BATCH_BOUND,
  type ReporterWorkerClient,
  reporterWorkerFactory,
  spawnReporterWorker,
  type SpawnReporterWorkerParams,
} from './reporter-stream.service.js'
export { WorkerLauncher } from './WorkerLauncher.service.js'
export { makeWorkerClient } from './worker-client.resource.js'
export {
  clientLayer as spawnedSocketWorkerClientLayer,
  isSpawnedSocketWorker,
  make as makeSpawnedSocketWorker,
  TypeId as SpawnedSocketWorkerTypeId,
} from './spawned-socket-worker.handle.js'
export type { SpawnedSocketWorker } from './spawned-socket-worker.handle.js'
export type { WorkerLauncherShape, WorkerSpawnParams } from './WorkerLauncher.service.js'
export type { WorkerClientParams } from './worker-client.resource.js'
