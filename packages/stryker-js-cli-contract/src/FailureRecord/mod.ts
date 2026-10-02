export { FailureCatalog, failureCatalogEntries, type RecordContext, recordOf } from '../failure-catalog.js'
export { CapsuleRule, CatalogEntry, CatalogExitCode } from '../failure-catalog.schema.js'
export {
  Capsule,
  CauseLink,
  DoesNotReplay,
  EnvEntry,
  FailedTestEvidence,
  FailureCode,
  FailureEvidence,
  FailureRecord,
  FailureRecordFile,
  FailureStage,
  NextAction,
  NextActionKind,
  NonReplayReason,
  PluginLoadRefusal,
  Replays,
  SourceLocation,
  TraceId,
  WorkerKind,
} from '../failure-record.schema.js'
export { annotationsOf, markdownOf, sarifTextOf, terminalTextOf } from '../render-failure.js'
