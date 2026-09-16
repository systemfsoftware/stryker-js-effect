import {
  CheckerFailed,
  CheckResultSchema,
  DryRunOptionsSchema,
  Mutant,
  MutantRunOptionsSchema,
  ReporterEventUnion,
  ReporterFailed,
  TestRunnerFailed,
} from '@systemfsoftware/stryker-js-language'
import * as S from 'effect/Schema'

export const WorkerPluginKind = S.Literals(['TestRunner', 'Checker', 'Reporter'])
export type WorkerPluginKind = typeof WorkerPluginKind.Type

export const TestRunnerDryRunRequest = S.Struct({ options: DryRunOptionsSchema })
export type TestRunnerDryRunRequest = typeof TestRunnerDryRunRequest.Type

export const TestRunnerMutantRunRequest = S.Struct({ options: MutantRunOptionsSchema })
export type TestRunnerMutantRunRequest = typeof TestRunnerMutantRunRequest.Type

export const CheckerRequest = S.Struct({ checkerName: S.String, mutants: S.Array(Mutant) })
export type CheckerRequest = typeof CheckerRequest.Type

export const CheckerCheckResult = S.Record(S.String, CheckResultSchema)
export const CheckerGroupResult = S.Array(S.Array(S.String))

export const ReporterInitOptions = S.Struct({
  traceparent: S.optionalKey(S.String),
  tracestate: S.optionalKey(S.String),
})
export type ReporterInitOptions = typeof ReporterInitOptions.Type

export const ReporterEventBatch = S.Array(ReporterEventUnion)
export type ReporterEventBatch = typeof ReporterEventBatch.Type

export const ReporterAck = S.Void
export const ReporterDrained = S.Void

export class BoundaryPayloadRejected extends S.TaggedError<BoundaryPayloadRejected>()(
  'BoundaryPayloadRejected',
  {
    pluginName: S.String,
    method: S.String,
    cause: S.String,
  },
) {}

export class BoundaryUnrecognizedSignal extends S.TaggedError<BoundaryUnrecognizedSignal>()(
  'BoundaryUnrecognizedSignal',
  {
    pluginName: S.String,
    method: S.String,
    signal: S.String,
  },
) {}

export class WorkerEntryMissing extends S.TaggedError<WorkerEntryMissing>()(
  'WorkerEntryMissing',
  {
    pluginName: S.String,
    specifier: S.String,
  },
) {}

export const BoundaryErrorSchema = S.Union([
  BoundaryPayloadRejected,
  BoundaryUnrecognizedSignal,
  WorkerEntryMissing,
  TestRunnerFailed,
  CheckerFailed,
  ReporterFailed,
])
export type BoundaryError = typeof BoundaryErrorSchema.Type

export const WorkerPluginEntryField = S.Literals(['bin', 'workerExport'])
export type WorkerPluginEntryField = typeof WorkerPluginEntryField.Type

export const WorkerPluginSpawnSchema = S.Struct({
  kind: WorkerPluginKind,
  field: WorkerPluginEntryField,
  entrypoint: S.String,
})
export type WorkerPluginSpawn = typeof WorkerPluginSpawnSchema.Type
