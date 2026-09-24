import * as Boolean from 'effect/Boolean'
import * as Effect from 'effect/Effect'
import * as S from 'effect/Schema'
import { SchemaGetter, SchemaIssue, SchemaTransformation } from 'effect'
export const TraceparentHeader = S.Literal('traceparent')
export const TracestateHeader = S.Literal('tracestate')
export const TraceContextPartsSchema = S.Struct({
  version: S.String.pipe(
    S.check(S.isPattern(/^[0-9a-f]{2}$/)),
    S.check(S.isPattern(/^([0-9a-e][0-9a-f]|[0-9a-f][0-9a-e])$/)),
  ),
  traceId: S.String.pipe(
    S.check(S.isPattern(/^[0-9a-f]{32}$/)),
    S.check(S.isPattern(/^[0-9a-f]*[1-9a-f][0-9a-f]*$/)),
  ),
  spanId: S.String.pipe(
    S.check(S.isPattern(/^[0-9a-f]{16}$/)),
    S.check(S.isPattern(/^[0-9a-f]*[1-9a-f][0-9a-f]*$/)),
  ),
  traceFlags: S.Int.pipe(S.check(S.isBetween({ minimum: 0, maximum: 255 }))),
  traceState: S.optional(S.String),
})
export type TraceContextParts = typeof TraceContextPartsSchema.Type

const TraceparentPartsSchema = S.Struct({
  version: S.String.pipe(
    S.check(S.isPattern(/^[0-9a-f]{2}$/)),
    S.check(S.isPattern(/^([0-9a-e][0-9a-f]|[0-9a-f][0-9a-e])$/)),
  ),
  traceId: S.String.pipe(
    S.check(S.isPattern(/^[0-9a-f]{32}$/)),
    S.check(S.isPattern(/^[0-9a-f]*[1-9a-f][0-9a-f]*$/)),
  ),
  spanId: S.String.pipe(
    S.check(S.isPattern(/^[0-9a-f]{16}$/)),
    S.check(S.isPattern(/^[0-9a-f]*[1-9a-f][0-9a-f]*$/)),
  ),
  traceFlags: S.Int.pipe(S.check(S.isBetween({ minimum: 0, maximum: 255 }))),
})

const HEX_VERSION = /^[0-9a-f]{2}$/
const HEX_TRACE_ID = /^[0-9a-f]{32}$/
const HEX_SPAN_ID = /^[0-9a-f]{16}$/
const HEX_FLAGS = /^[0-9a-f]{2}$/
const ALL_ZERO = /^0+$/
const FORBIDDEN_VERSION = 'ff'
const CURRENT_VERSION = '00'
const TRACEPARENT_FIELD_COUNT = 4

const fieldAt = (fields: readonly string[], index: number) => fields[index] ?? ''

const isNonZeroHex = (pattern: RegExp, value: string) =>
  pattern.test(value) && !ALL_ZERO.test(value)

const acceptsFieldCount = (version: string, count: number) =>
  version !== CURRENT_VERSION || count === TRACEPARENT_FIELD_COUNT

const isKnownVersion = (version: string) =>
  HEX_VERSION.test(version) && version !== FORBIDDEN_VERSION

const isWellFormedTraceparent = (value: string) => {
  const fields = value.split('-')
  return [
    acceptsFieldCount(fieldAt(fields, 0), fields.length),
    isKnownVersion(fieldAt(fields, 0)),
    isNonZeroHex(HEX_TRACE_ID, fieldAt(fields, 1)),
    isNonZeroHex(HEX_SPAN_ID, fieldAt(fields, 2)),
    HEX_FLAGS.test(fieldAt(fields, 3)),
  ].every((check) => check)
}

const partsOf = (value: string) => {
  const fields = value.split('-')
  return {
    version: fieldAt(fields, 0),
    traceId: fieldAt(fields, 1),
    spanId: fieldAt(fields, 2),
    traceFlags: Number.parseInt(fieldAt(fields, 3), 16),
  }
}

const formatOf = (parts: { readonly version: string; readonly traceId: string; readonly spanId: string; readonly traceFlags: number }) =>
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
    TraceparentPartsSchema,
    SchemaTransformation.makeTransformation({ decode: decodeParts, encode: encodeText }),
  ),
)

