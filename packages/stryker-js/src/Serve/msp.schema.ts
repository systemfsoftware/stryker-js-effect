/**
 * The Mutation Server Protocol payloads this server speaks, as Effect schemas.
 *
 * The shapes are the published ones from `mutation-server-protocol`
 * (stryker-mutator/editor-plugins, `packages/mutation-server-protocol`,
 * published 0.4.1 at commit 47c1ee72b6238620474ec23082369491473d03dd —
 * https://cdn.jsdelivr.net/npm/mutation-server-protocol@0.4.1/README.md):
 * `ConfigureParams`/`ConfigureResult`, `DiscoverParams`/`DiscoverResult`,
 * `MutationTestParams`/`MutationTestResult`, and the
 * `reportMutationTestProgress` notification. Locations reuse the
 * mutation-testing-report schema's 1-based, end-exclusive `Position`/`Location`
 * through `Report`, which is the same base this engine already emits.
 *
 * `MSP_PROTOCOL_VERSION` is the version StrykerJS v10 answers `configure` with
 * (its `StrykerServer.configure` returns `{ version: '0.4.0' }`); the protocol
 * asks the server to name the version it supports, so the answer follows the
 * implementation clients were written against rather than the npm release.
 *
 * The base protocol is JSON-RPC 2.0: a request with an `id` is answered with a
 * matching result or error, a request without one is a notification, and the
 * server may push the progress notification at any time.
 */
import { Mutant, Report } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

export class ServeError extends S.TaggedError<ServeError>()('ServeError', {
  reason: S.String,
  cause: S.optionalKey(S.Unknown),
}) {
  override get message(): string {
    return this.reason
  }
}

export type MspVersion = string

export const MSP_PROTOCOL_VERSION: MspVersion = '0.4.0'

export interface MspMethodTable {
  readonly configure: 'configure'
  readonly discover: 'discover'
  readonly mutationTest: 'mutationTest'
  readonly reportMutationTestProgress: 'reportMutationTestProgress'
}

export const MSP_METHODS: MspMethodTable = {
  configure: 'configure',
  discover: 'discover',
  mutationTest: 'mutationTest',
  reportMutationTestProgress: 'reportMutationTestProgress',
}

export const MspMethod = S.Literals([
  MSP_METHODS.configure,
  MSP_METHODS.discover,
  MSP_METHODS.mutationTest,
  MSP_METHODS.reportMutationTestProgress,
])
export type MspMethod = typeof MspMethod.Type

export const JsonRpcVersion = S.Literal('2.0')
export const JsonRpcId = S.Union([S.String, S.Finite, S.Null])
export type JsonRpcId = typeof JsonRpcId.Type

export const JsonRpcRequest = S.Struct({
  jsonrpc: JsonRpcVersion,
  id: S.optionalKey(JsonRpcId),
  method: S.String,
  params: S.optionalKey(S.Json),
})
export type JsonRpcRequest = typeof JsonRpcRequest.Type

export const JsonRpcErrorObject = S.Struct({
  code: S.Int,
  message: S.String,
  data: S.optionalKey(S.Json),
})

export type MspErrorCode = number

export const MSP_PARSE_ERROR: MspErrorCode = -32700
export const MSP_INVALID_REQUEST: MspErrorCode = -32600
export const MSP_METHOD_NOT_FOUND: MspErrorCode = -32601
export const MSP_INVALID_PARAMS: MspErrorCode = -32602
export const MSP_INTERNAL_ERROR: MspErrorCode = -32603
export const MSP_SERVER_BUSY: MspErrorCode = -32000

export const JsonRpcErrorResponse = S.Struct({
  jsonrpc: JsonRpcVersion,
  id: S.NullOr(JsonRpcId),
  error: JsonRpcErrorObject,
})

export const JsonRpcResultResponse = S.Struct({
  jsonrpc: JsonRpcVersion,
  id: JsonRpcId,
  result: S.Unknown,
})

export const JsonRpcResponse = S.Union([JsonRpcResultResponse, JsonRpcErrorResponse])
export type JsonRpcResponse = typeof JsonRpcResponse.Type

export type MspLocation = Report.Location
export type MspMutantStatus = Mutant.MutantStatus
export type MspMutantResult = Report.MutantResult

export const FileRange = S.Struct({
  path: S.String,
  range: S.optionalKey(Report.Location),
})
export type FileRange = typeof FileRange.Type

export const ConfigureParams = S.Struct({ configFilePath: S.optionalKey(S.String) })
export type ConfigureParams = typeof ConfigureParams.Type

export const ConfigureResult = S.Struct({ version: S.String })
export type ConfigureResult = typeof ConfigureResult.Type

export const DiscoveredMutant = S.Struct({
  id: S.String,
  location: Report.Location,
  description: S.optionalKey(S.String),
  mutatorName: S.String,
  replacement: S.optionalKey(S.String),
})
export type DiscoveredMutant = typeof DiscoveredMutant.Type

export const DiscoveredFile = S.Struct({ mutants: S.Array(DiscoveredMutant) })
export type DiscoveredFile = typeof DiscoveredFile.Type

export const DiscoveredFiles = S.Record(S.String, DiscoveredFile)
export type DiscoveredFiles = typeof DiscoveredFiles.Type

const FileRanges = S.Array(FileRange)

export const DiscoverParams = S.Struct({ files: FileRanges.pipe(S.optionalKey) })
export type DiscoverParams = typeof DiscoverParams.Type

export const DiscoverResult = S.Struct({ files: DiscoveredFiles })
export type DiscoverResult = typeof DiscoverResult.Type

export const MutationTestParams = S.Struct({
  files: FileRanges.pipe(S.optionalKey),
  mutants: S.optionalKey(DiscoveredFiles),
})
export type MutationTestParams = typeof MutationTestParams.Type

export const MutationTestResult = S.Struct({
  files: S.Record(S.String, S.Struct({ mutants: S.Array(Report.MutantResult) })),
})
export type MutationTestResult = typeof MutationTestResult.Type

export const ReportMutationTestProgress = S.Struct({
  jsonrpc: JsonRpcVersion,
  method: S.Literal(MSP_METHODS.reportMutationTestProgress),
  params: MutationTestResult,
})
export type ReportMutationTestProgress = typeof ReportMutationTestProgress.Type

export type MspEncoder<A> = (value: A) => Result.Result<string, S.SchemaError>
export type MspParamDecoder<A> = (params: S.Json | undefined) => Result.Result<A, S.SchemaError>

export const encodeJsonRpcResponse: MspEncoder<JsonRpcResponse> = S.encodeResult(S.fromJsonString(JsonRpcResponse))
export const encodeProgressNotification: MspEncoder<ReportMutationTestProgress> = S.encodeResult(
  S.fromJsonString(ReportMutationTestProgress),
)
export const decodeJsonRpcRequest: MspParamDecoder<JsonRpcRequest> = S.decodeUnknownResult(
  S.fromJsonString(JsonRpcRequest),
)
export const decodeConfigureParams: MspParamDecoder<ConfigureParams> = S.decodeUnknownResult(ConfigureParams)
export const decodeDiscoverParams: MspParamDecoder<DiscoverParams> = S.decodeUnknownResult(DiscoverParams)
export const decodeMutationTestParams: MspParamDecoder<MutationTestParams> = S.decodeUnknownResult(
  MutationTestParams,
)

export type MutatePatterns = ReadonlyArray<string>

/**
 * The `targetMutatePatterns` this engine takes for a `FileRange` list, or
 * `undefined` when no restriction was asked for. A trailing slash means a
 * directory, matching the protocol.
 *
 * The positions pass through verbatim. This engine compares a range's `end`
 * against a mutant location's `end`, and both of those ends are the report
 * schema's 1-based, exclusive end — the same coordinate space MSP defines for
 * `Location` — so MSP's start-inclusive, end-exclusive range needs no
 * arithmetic here. (StrykerJS v10 subtracts one from both columns instead,
 * because its own mutate ranges are exclusive at the start; copying that would
 * shift this engine's start by a character.)
 */
export const restrictPatternsOf = (
  files: ReadonlyArray<FileRange> | undefined,
): MutatePatterns | undefined =>
  Option.getOrUndefined(
    Option.map(
      Option.filter(Option.fromUndefinedOr(files), (scopes) => scopes.length > 0),
      (scopes) => scopes.map(patternOf),
    ),
  )

const patternOf = (file: FileRange): string =>
  Option.match(Option.fromUndefinedOr(file.range), {
    onNone: () => basePatternOf(file.path),
    onSome: (range) => `${basePatternOf(file.path)}:${rangeTextOf(range)}`,
  })

const basePatternOf = (path: string): string =>
  Match.value(path.endsWith('/')).pipe(
    Match.when(true, () => `${path}**/*`),
    Match.when(false, () => path),
    Match.exhaustive,
  )

const rangeTextOf = (range: NonNullable<FileRange['range']>): string =>
  `${range.start.line}:${range.start.column}-${range.end.line}:${range.end.column}`
