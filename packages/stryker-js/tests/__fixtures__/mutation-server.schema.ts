import type { Serve } from '@systemfsoftware/stryker-js'
import * as Exit from 'effect/Exit'
import * as S from 'effect/Schema'

export const ExitValue = S.declare<Exit.Exit<void, Serve.ServeError>>((
  input,
): input is Exit.Exit<void, Serve.ServeError> => typeof input === 'object' && input !== null)

export const JsonRpcId = S.Union([S.String, S.Finite, S.Null])
export type JsonRpcId = typeof JsonRpcId.Type

export const JsonRpcError = S.Struct({ code: S.Int, message: S.String })

export const JsonRpcResponse = S.Struct({
  jsonrpc: S.Literal('2.0'),
  id: S.Union([JsonRpcId, S.Undefined]),
  result: S.optionalKey(S.Unknown),
  error: S.optionalKey(JsonRpcError),
})
export type JsonRpcResponse = typeof JsonRpcResponse.Type

export const ReboundAnnounced = S.TaggedStruct('announced', { line: S.String })
export const ReboundExited = S.TaggedStruct('exited', { exit: ExitValue })
export type ReboundOutcome = typeof ReboundAnnounced.Type | typeof ReboundExited.Type

export const ConfigureResult = S.Struct({ version: S.String })

const RatedMutant = S.Struct({ id: S.String, status: S.String })

const Position = S.Struct({ line: S.Finite, column: S.Finite })
export const Location = S.Struct({ start: Position, end: Position })
export type Location = typeof Location.Type

export const DiscoveredMutant = S.Struct({
  id: S.String,
  location: Location,
  mutatorName: S.String,
  replacement: S.optionalKey(S.String),
  description: S.optionalKey(S.String),
})
export type DiscoveredMutant = typeof DiscoveredMutant.Type

export const DiscoveredFiles = S.Struct({
  files: S.Record(S.String, S.Struct({ mutants: S.Array(DiscoveredMutant) })),
})
export type DiscoveredFiles = typeof DiscoveredFiles.Type

export const MutantResultFiles = S.Struct({
  files: S.Record(S.String, S.Struct({ mutants: S.Array(RatedMutant) })),
})
export type MutantResultFiles = typeof MutantResultFiles.Type

export const ProgressNotification = S.Struct({
  jsonrpc: S.Literal('2.0'),
  method: S.Literal('reportMutationTestProgress'),
  params: MutantResultFiles,
})
export type ProgressNotification = typeof ProgressNotification.Type

export const AnyNotification = S.Struct({
  jsonrpc: S.Literal('2.0'),
  method: S.String,
  params: S.Unknown,
})
