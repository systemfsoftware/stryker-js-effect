import * as Context from 'effect/Context'
import * as Option from 'effect/Option'

import type { Traceparent } from './TraceContext.schema.js'

export const TRACEPARENT_HEADER = 'traceparent'
export const TRACESTATE_HEADER = 'tracestate'

export interface TraceContextParts {
  readonly version: string
  readonly traceId: string
  readonly spanId: string
  readonly traceFlags: number
  readonly traceState?: string | undefined
}

export const formatTraceparent = (parts: TraceContextParts): Traceparent =>
  `${parts.version}-${parts.traceId}-${parts.spanId}-${(parts.traceFlags & 0xff).toString(16).padStart(2, '0')}`

const HEX_VERSION = /^[0-9a-f]{2}$/
const HEX_TRACE_ID = /^[0-9a-f]{32}$/
const HEX_SPAN_ID = /^[0-9a-f]{16}$/
const HEX_FLAGS = /^[0-9a-f]{2}$/
const ALL_ZERO = /^0+$/
const FORBIDDEN_VERSION = 'ff'
const CURRENT_VERSION = '00'
const TRACEPARENT_FIELD_COUNT = 4

interface TraceparentFields {
  readonly version: string
  readonly traceId: string
  readonly spanId: string
  readonly flags: string
}

const fieldAt = (fields: readonly string[], index: number): string => fields[index] ?? ''

const traceparentFields = (parts: readonly string[]): TraceparentFields => ({
  version: fieldAt(parts, 0),
  traceId: fieldAt(parts, 1),
  spanId: fieldAt(parts, 2),
  flags: fieldAt(parts, 3),
})

const acceptsFieldCount = (version: string, count: number): boolean =>
  version !== CURRENT_VERSION || count === TRACEPARENT_FIELD_COUNT

const isKnownVersion = (version: string): boolean => HEX_VERSION.test(version) && version !== FORBIDDEN_VERSION

const isNonZeroHex = (pattern: RegExp, value: string): boolean => pattern.test(value) && !ALL_ZERO.test(value)

const isWellFormedTraceparent = (fields: TraceparentFields, fieldCount: number): boolean =>
  [
    acceptsFieldCount(fields.version, fieldCount),
    isKnownVersion(fields.version),
    isNonZeroHex(HEX_TRACE_ID, fields.traceId),
    isNonZeroHex(HEX_SPAN_ID, fields.spanId),
    HEX_FLAGS.test(fields.flags),
  ].every((check) => check)

export const parseTraceparent = (value: string): Option.Option<TraceContextParts> => {
  const parts = value.split('-')
  const fields = traceparentFields(parts)
  return Option.map(
    Option.liftPredicate(fields, (candidate) => isWellFormedTraceparent(candidate, parts.length)),
    (wellFormed) => ({
      version: wellFormed.version,
      traceId: wellFormed.traceId,
      spanId: wellFormed.spanId,
      traceFlags: Number.parseInt(wellFormed.flags, 16),
    }),
  )
}

export const TraceContextReference: Context.Reference<Option.Option<TraceContextParts>> = Context.Reference(
  '@systemfsoftware/stryker-js-plugin-interface/TraceContextReference',
  { defaultValue: () => Option.none() },
)
