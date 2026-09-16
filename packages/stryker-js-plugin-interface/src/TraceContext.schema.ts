import * as S from 'effect/Schema'

const TRACEPARENT_PATTERN = /^[0-9a-f]{2}-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$/

export const Traceparent = S.String.check(
  S.isPattern(TRACEPARENT_PATTERN, { expected: 'a W3C traceparent: version-traceId-spanId-flags' }),
)
export type Traceparent = typeof Traceparent.Type

export const TraceContext = S.Struct({
  traceparent: Traceparent,
  tracestate: S.optionalKey(S.String),
})
export type TraceContext = typeof TraceContext.Type
