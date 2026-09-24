import { Mutant } from '@systemfsoftware/stryker-js-instrumenter'
import * as S from 'effect/Schema'

import { CheckerFailed, CheckerMutantWire, CheckResultSchema } from './Checker.schema.js'
import { ReporterEventUnion, ReporterFailed } from './ReporterEvent.schema.js'

import { DryRunOptionsSchema, TestRunnerFailed } from './TestRunner.schema.js'

export const WorkerPluginKind = S.Literals(['TestRunner', 'Checker', 'Reporter'])
export type WorkerPluginKind = typeof WorkerPluginKind.Type

export const TestRunnerDryRunRequest = S.Struct({ options: DryRunOptionsSchema })
export type TestRunnerDryRunRequest = typeof TestRunnerDryRunRequest.Type

export const TestRunnerMutantRunRequest = S.Struct({ options: Mutant.MutantRunOptionsSchema })
export type TestRunnerMutantRunRequest = typeof TestRunnerMutantRunRequest.Type

export const CheckerRequest = S.Struct({ checkerName: S.String, mutants: S.Array(CheckerMutantWire) })
export type CheckerRequest = typeof CheckerRequest.Type

export const CheckerCheckResult = S.Record(S.String, CheckResultSchema)
export const CheckerGroupResult = S.String.pipe(S.Array, S.Array)

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

export const BoundaryErrorSchema = S.Union([
  BoundaryPayloadRejected,
  BoundaryUnrecognizedSignal,
  TestRunnerFailed,
  CheckerFailed,
  ReporterFailed,
])
export type BoundaryError = typeof BoundaryErrorSchema.Type

const FILE_URL_PREFIX = /^file:\/\//

export const WorkerEntryUrl = S.String.check(
  S.isPattern(FILE_URL_PREFIX, { expected: 'a file: URL of the worker program' }),
)
export type WorkerEntryUrl = typeof WorkerEntryUrl.Type

export const WorkerPluginSpawnSchema = S.Struct({
  kind: WorkerPluginKind,
  entrypoint: WorkerEntryUrl,
})
export type WorkerPluginSpawn = typeof WorkerPluginSpawnSchema.Type
