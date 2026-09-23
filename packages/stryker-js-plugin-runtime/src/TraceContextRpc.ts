import * as api from '@opentelemetry/api'
import * as Option from 'effect/Option'

import type { TraceContextParts } from '@systemfsoftware/stryker-js-plugin-interface'

const CURRENT_VERSION = '00'

export const SAMPLED_FLAG = 0x01

const serializedTraceState = (traceState: api.TraceState | undefined): Option.Option<string> =>
  Option.filter(
    Option.map(Option.fromUndefinedOr(traceState), (state) => state.serialize()),
    (serialized) => serialized.length > 0,
  )

const traceStateField = (traceState: api.TraceState | undefined): { readonly traceState?: string } =>
  Option.match(serializedTraceState(traceState), {
    onNone: () => ({}),
    onSome: (serialized) => ({ traceState: serialized }),
  })

export const tracePartsOf = (context: api.SpanContext): Option.Option<TraceContextParts> =>
  Option.map(
    Option.liftPredicate(context, (candidate) => api.trace.isSpanContextValid(candidate)),
    (valid) => ({
      version: CURRENT_VERSION,
      traceId: valid.traceId,
      spanId: valid.spanId,
      traceFlags: valid.traceFlags,
      ...traceStateField(valid.traceState),
    }),
  )

const sampledFlagOf = (sampled: boolean): number => {
  if (sampled) return SAMPLED_FLAG
  return 0
}

export const partsOfEffectSpan = (span: {
  readonly traceId: string
  readonly spanId: string
  readonly sampled: boolean
}): TraceContextParts => ({
  version: CURRENT_VERSION,
  traceId: span.traceId,
  spanId: span.spanId,
  traceFlags: sampledFlagOf(span.sampled),
})
