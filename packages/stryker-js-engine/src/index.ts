export { type CheckerResourceService, checkGroupedPlans } from './Checker.js'
export { makeRunLayer, mutationTestCell, RUN_EVENTS_QUEUE_BOUND, shouldKeepTempDir } from './Run.js'
export type { DryRunDone } from './run/dry-run.cell.js'
export type { InstrumentDone } from './run/instrument.cell.js'
export type { MutationTestDone } from './run/mutation-test.cell.js'
export type { PrepareDone, PrepareExecutorArgs } from './run/prepare.cell.js'
export { RunEnvironment } from './run/RunEnvironment.js'
export type { RunEnvironmentShape } from './run/RunEnvironment.js'
export type { EnginePorts, RunStageServices, WiredRunLayer } from './run/StageServices.js'

export { calculateMetrics, countMutants } from './calculate-metrics.js'

export { EXIT_CODE, ExitClass, highestExitClass, resolveExitCode, verdictExitClass } from './exit-classification.js'

export {
  CONFIG_SYNTAX_HELP,
  createDefaultOptions,
  createFileMatcher,
  decideExtendsStep,
  deepFreeze,
  defaultOptions,
  describeErrors,
  findUnserializables,
  forkCoreSchema,
  importModule,
  initialExtendsStepState,
  isModuleSpecifier,
  isWarningEnabled,
  matchesFile,
  mergeConfigs,
  mergeRecords,
  optionsPath,
  readConfig,
  REMOVED_OPTIONS,
  resolveExtends,
  SUPPORTED_CONFIG_FILE_NAMES,
  validateOptions,
} from './Config.js'
export type {
  ExtendsRefusalReason,
  ExtendsStepDecision,
  ExtendsStepDocument,
  ExtendsStepState,
  Immutable,
  Primitive,
  UnserializableDescription,
  ValidationSchemaDocument,
  WarningOptions,
} from './Config.js'
export {
  ConfigDocumentSchema,
  ConfigError,
  ConfigFileInvalidError,
  ConfigFileNotFoundError,
  ConfigFileUnreadableError,
  ConfigFileUnsupportedError,
  extendsPropertySchema,
  forkOptionsSchema,
  ImportedModuleSchema,
  MergeCommand,
  MergeResult,
  ReadConfigCommand,
  survivorsPriorReport,
} from './Config.schema.js'

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

export { StageError } from './Run.schema.js'
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
