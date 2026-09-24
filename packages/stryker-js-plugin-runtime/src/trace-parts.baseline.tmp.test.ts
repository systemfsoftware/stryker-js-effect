import { describe, expect, it } from 'vitest'
import * as api from '@opentelemetry/api'
import * as Option from 'effect/Option'
import * as S from 'effect/Schema'

import { TraceContextPartsFromEffectSpan, TraceContextPartsFromSpanContext } from './trace-parts.schema.js'

// eslint-disable-next-line import/no-unresolved
const baseline = await import(
  '/tmp/refactor/baseline/packages/stryker-js-plugin-runtime/dist/index.mjs'
)

const traceId = '4bf92f3577b34da6a3ce929d0e0e4736'
const spanId = '00f067aa0ba902b7'

const stateOf = (state: string | undefined) =>
  Option.match(Option.fromUndefinedOr(state), {
    onNone: () => ({}),
    onSome: (present) => ({ traceState: api.createTraceState(present) }),
  })

const contexts: ReadonlyArray<api.SpanContext> = [0, 1, 2, 255].flatMap((traceFlags) =>
  [undefined, '', 'k=v', 'a=1,b=2'].map((traceState) => ({
    traceId,
    spanId,
    traceFlags,
    ...stateOf(traceState),
    isRemote: false,
  })),
)

const invalid: ReadonlyArray<api.SpanContext> = [
  { traceId: '0'.repeat(32), spanId, traceFlags: 1 },
  { traceId: traceId.slice(1), spanId, traceFlags: 1 },
  { traceId, spanId: '0'.repeat(16), traceFlags: 1 },
  { traceId, spanId: spanId.slice(1), traceFlags: 1 },
]

describe('old-vs-new trace conversions (throwaway, baseline oracle)', () => {
  it('span context decode matches baseline tracePartsOf on valid contexts', () => {
    for (const context of contexts) {
      expect(Option.getOrUndefined(S.decodeUnknownOption(TraceContextPartsFromSpanContext)(context))).toStrictEqual(
        Option.getOrUndefined(baseline.tracePartsOf(context)),
      )
    }
  })

  it('span context decode matches baseline tracePartsOf on invalid contexts', () => {
    for (const context of invalid) {
      expect(S.decodeUnknownOption(TraceContextPartsFromSpanContext)(context)).toStrictEqual(
        baseline.tracePartsOf(context),
      )
    }
  })

  it('effect span decode matches baseline partsOfEffectSpan', () => {
    for (const sampled of [true, false]) {
      expect(
        Option.getOrUndefined(S.decodeUnknownOption(TraceContextPartsFromEffectSpan)({ traceId, spanId, sampled })),
      ).toStrictEqual(baseline.partsOfEffectSpan({ traceId, spanId, sampled }))
    }
  })
})
