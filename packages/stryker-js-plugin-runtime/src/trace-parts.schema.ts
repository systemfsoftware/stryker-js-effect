import * as Boolean from 'effect/Boolean'
import * as S from 'effect/Schema'
import * as SchemaTransformation from 'effect/SchemaTransformation'

import { Trace } from '@systemfsoftware/stryker-js-plugin-interface'

const CURRENT_VERSION = '00'
const SAMPLED_FLAG = 0x01

const EffectSpanShape = S.Struct({
  traceId: S.String,
  spanId: S.String,
  sampled: S.Boolean,
})
export type EffectSpanIdentity = {
  readonly traceId: string
  readonly spanId: string
  readonly sampled: boolean
}

const sampledFlagOf = (sampled: boolean) => Boolean.match(sampled, { onTrue: () => SAMPLED_FLAG, onFalse: () => 0 })

const sampledOf = (traceFlags: number) => (traceFlags & SAMPLED_FLAG) === SAMPLED_FLAG

export const TraceContextPartsFromEffectSpan: S.Codec<Trace.TraceContextParts, EffectSpanIdentity> = EffectSpanShape
  .pipe(
    S.decodeTo(
      Trace.TraceContextPartsSchema,
      SchemaTransformation.transform({
        decode: (span) => ({
          version: CURRENT_VERSION,
          traceId: span.traceId,
          spanId: span.spanId,
          traceFlags: sampledFlagOf(span.sampled),
        }),
        encode: (parts) => ({
          traceId: parts.traceId,
          spanId: parts.spanId,
          sampled: sampledOf(parts.traceFlags),
        }),
      }),
    ),
  )
