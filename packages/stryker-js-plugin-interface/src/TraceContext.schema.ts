import * as Boolean from 'effect/Boolean'
import * as Effect from 'effect/Effect'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import { SchemaGetter, SchemaIssue, SchemaTransformation } from 'effect'
export const TraceparentHeader = S.Literal('traceparent')
export const TracestateHeader = S.Literal('tracestate')
export const TraceContextPartsSchema = S.Struct({
  version: S.String,
  traceId: S.String,
  spanId: S.String,
  traceFlags: S.Finite.pipe(S.check(S.isBetween({ minimum: 0, maximum: 255 }))),
  traceState: S.optional(S.String),
})
export type TraceContextParts = typeof TraceContextPartsSchema.Type

const HEX_VERSION = /^[0-9a-f]{2}$/
const HEX_TRACE_ID = /^[0-9a-f]{32}$/
const HEX_SPAN_ID = /^[0-9a-f]{16}$/
const HEX_FLAGS = /^[0-9a-f]{2}$/
const ALL_ZERO = /^0+$/
const FORBIDDEN_VERSION = 'ff'
const CURRENT_VERSION = '00'
const TRACEPARENT_FIELD_COUNT = 4

const isNonZeroHex = (pattern: RegExp, value: string) =>
  pattern.test(value) && !ALL_ZERO.test(value)

const acceptsFieldCount = (version: string, count: number) =>
  version !== CURRENT_VERSION || count === TRACEPARENT_FIELD_COUNT

const isKnownVersion = (version: string) =>
  HEX_VERSION.test(version) && version !== FORBIDDEN_VERSION

const isWellFormedTraceparent = (value: string) => {
  const fields = value.split('-')
  return [
    acceptsFieldCount(fields[0] ?? '', fields.length),
    isKnownVersion(fields[0] ?? ''),
    isNonZeroHex(HEX_TRACE_ID, fields[1] ?? ''),
    isNonZeroHex(HEX_SPAN_ID, fields[2] ?? ''),
    HEX_FLAGS.test(fields[3] ?? ''),
  ].every((check) => check)
}

const partsOf = (value: string) => {
  const [version = '', traceId = '', spanId = '', flags = ''] = value.split('-')
  return {
    version,
    traceId,
    spanId,
    traceFlags: Number.parseInt(flags, 16),
  }
}

const formatOf = (parts: TraceContextParts) =>
  `${parts.version}-${parts.traceId}-${parts.spanId}-${(parts.traceFlags & 0xff).toString(16).padStart(2, '0')}`

const malformedTraceparent = (value: string) =>
  new SchemaIssue.InvalidValue({ message: 'expected a W3C traceparent: version-traceId-spanId-flags' }, value)

const decodeParts = SchemaGetter.transformEffect((value: string) =>
  Boolean.match(isWellFormedTraceparent(value), {
    onTrue: () => Effect.succeed(partsOf(value)),
    onFalse: () => Effect.fail(malformedTraceparent(value)),
  })
)

const encodeText = SchemaGetter.transform(formatOf)

export const Traceparent = S.String.pipe(
  S.decodeTo(
    TraceContextPartsSchema,
    SchemaTransformation.makeTransformation({ decode: decodeParts, encode: encodeText }),
  ),
)

if (import.meta.vitest !== void 0) {
  // @effect/vitest is dev-only; a static import would put it in the library import graph of every consumer.
  const { it } = await import('@effect/vitest')

  const hexOf = (length: number) => S.String.pipe(S.check(S.isPattern(new RegExp(`^[0-9a-f]{${length}}$`))))
  const nonZeroHexOf = (length: number) =>
    S.String.pipe(S.check(S.isPattern(new RegExp(`^[0-9a-f]{${length - 1}}[1-9a-f]$`))))

  const RoundTrippableParts = S.Struct({
    version: S.String.pipe(S.check(S.isPattern(/^(?!ff$)[0-9a-f]{2}$/))),
    traceId: nonZeroHexOf(32),
    spanId: nonZeroHexOf(16),
    traceFlags: S.Finite.pipe(S.check(S.isBetween({ minimum: 0, maximum: 255 }))),
  })

  it.prop('∀parts_Traceparent_roundTripsThroughTheHeader', [RoundTrippableParts], ([parts]) =>
    Result.match(S.encodeResult(Traceparent)(parts), {
      onFailure: () => false,
      onSuccess: (header) =>
        Result.match(S.decodeResult(Traceparent)(header), {
          onFailure: () => false,
          onSuccess: (parsed) =>
            parsed.version === parts.version && parsed.traceId === parts.traceId &&
            parsed.spanId === parts.spanId && parsed.traceFlags === parts.traceFlags,
        }),
    }))

  it.prop('∀parts_Traceparent_rendersTheBaselineHeader', [RoundTrippableParts], ([parts]) =>
    Result.match(S.encodeResult(Traceparent)(parts), {
      onFailure: () => false,
      onSuccess: (header) =>
        header ===
        `${parts.version}-${parts.traceId}-${parts.spanId}-${parts.traceFlags.toString(16).padStart(2, '0')}`,
    }))

  it.prop('∀version_Traceparent_refusesTheForbiddenVersion', [hexOf(2)], ([version]) =>
    Result.isSuccess(S.decodeResult(Traceparent)(`${version}-${'a'.repeat(32)}-${'b'.repeat(16)}-01`)) ===
      (version !== 'ff'))

  it.prop('∀traceId_Traceparent_refusesTheAllZeroId', [hexOf(32)], ([traceId]) =>
    Result.isSuccess(S.decodeResult(Traceparent)(`00-${traceId}-${'b'.repeat(16)}-01`)) === !/^0+$/.test(traceId))
}
