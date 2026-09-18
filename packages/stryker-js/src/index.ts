import type { PartialStrykerOptions } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as Path from 'effect/Path'
import type { PlatformError } from 'effect/PlatformError'
import * as Stdio from 'effect/Stdio'
import type { ResolvedMode } from './output-mode.js'
import type { MutationTestDone } from './run/mutation-test.cell.js'

import { makeRunEventStream } from './Output.js'
import { hostOptionsOf, prepareCommandOf, runOnHost } from './run-host.js'
import { makeRunLayer, mutationTestCell, RUN_EVENTS_QUEUE_BOUND, shouldKeepTempDir } from './Run.js'
import { StageError } from './Run.schema.js'

export type { CheckerResourceService } from './Checker.js'
export type { DryRunDone } from './run/dry-run.cell.js'
export type { InstrumentDone } from './run/instrument.cell.js'
export type { MutationTestDone } from './run/mutation-test.cell.js'
export type { PrepareDone, PrepareExecutorArgs } from './run/prepare.cell.js'
export type { RunEnvironmentShape } from './run/RunEnvironment.js'
export type { EnginePorts, RunStageServices, WiredRunLayer } from './run/StageServices.js'
export type { StrykerRun } from './StrykerRun.js'
export type { PooledTestRunner, PooledTestRunnerError, TestRunnerBuildContext } from './TestRunner.js'

export { checkGroupedPlans } from './Checker.js'
export { StageError } from './Run.schema.js'
export { RunEnvironment } from './run/RunEnvironment.js'
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
export type { CompiledTests, VmModule, VmModuleBuiltin, VmPlatform, VmScript, VmTestRunnerConfig } from './VmRunner.js'

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
export type { Immutable, Primitive, UnserializableDescription, WarningOptions } from './config-defaults.js'
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
  resolveExtends,
  validateOptions,
} from './run/load-config.cell.js'
export type {
  ConfigInvocation,
  ExtendsRefusalReason,
  ExtendsStepDecision,
  ExtendsStepDocument,
  ExtendsStepState,
  ValidationSchemaDocument,
} from './run/load-config.cell.js'

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
    const stdio = yield* Stdio.Stdio
    const stream = yield* makeRunEventStream(stdio, HEADLESS_MODE)
    const env = yield* hostOptionsOf(HEADLESS_MODE, stream, undefined)
    let patterns: string[] | undefined
    if (targetMutatePatterns !== undefined) {
      patterns = [...targetMutatePatterns]
    }
    return yield* runOnHost({ env, events: stream.queue }, prepareCommandOf(options, patterns))
  })
