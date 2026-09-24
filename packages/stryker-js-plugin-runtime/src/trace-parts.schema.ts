import * as api from '@opentelemetry/api'
import * as Boolean from 'effect/Boolean'
import * as Effect from 'effect/Effect'
import * as Option from 'effect/Option'
import * as S from 'effect/Schema'
import * as SchemaIssue from 'effect/SchemaIssue'
import * as SchemaTransformation from 'effect/SchemaTransformation'

import type { TraceContextParts } from '@systemfsoftware/stryker-js-plugin-interface'

const CURRENT_VERSION = '00'
const SAMPLED_FLAG = 0x01

const PartsWire = S.Struct({
  version: S.String,
  traceId: S.String,
  spanId: S.String,
  traceFlags: S.Finite,
  traceState: S.optional(S.String),
})

const isTraceContextParts = (candidate: unknown): candidate is TraceContextParts => S.is(PartsWire)(candidate)

const Parts = S.declare<TraceContextParts>(isTraceContextParts, {
  message: 'expected W3C trace context parts',
})

export type EffectSpanIdentity = S.Schema.Type<typeof EffectSpanShape>

const EffectSpanShape = S.Struct({
  traceId: S.String,
  spanId: S.String,
  sampled: S.Boolean,
})

const SpanContextRecord = S.Struct({
  traceId: S.String,
  spanId: S.String,
  traceFlags: S.Finite,
  traceState: S.optional(S.Unknown),
  isRemote: S.optional(S.Boolean),
})

const isSpanContextRecord = (candidate: unknown): candidate is api.SpanContext => S.is(SpanContextRecord)(candidate)

const SpanContext = S.declare<api.SpanContext>(isSpanContextRecord, {
  message: 'expected an OpenTelemetry span context',
})

const serializedTraceStateOf = (traceState: api.TraceState | undefined): Option.Option<string> =>
  Option.filter(
    Option.map(Option.fromUndefinedOr(traceState), (state) => state.serialize()),
    (serialized) => serialized.length > 0,
  )

const traceStateFieldOf = (traceState: api.TraceState | undefined): { readonly traceState?: string } =>
  Option.match(serializedTraceStateOf(traceState), {
    onNone: () => ({}),
    onSome: (serialized) => ({ traceState: serialized }),
  })

const traceStateEntryOf = (traceState: string | undefined) =>
  Option.match(Option.map(Option.fromUndefinedOr(traceState), (state) => api.createTraceState(state)), {
    onNone: () => ({}),
    onSome: (state) => ({ traceState: state }),
  })

const sampledFlagOf = (sampled: boolean) =>
  Boolean.match(sampled, { onTrue: () => SAMPLED_FLAG, onFalse: () => 0 })

const sampledOf = (traceFlags: number) => (traceFlags & SAMPLED_FLAG) === SAMPLED_FLAG

const spanContextOf = (parts: TraceContextParts) => ({
  traceId: parts.traceId,
  spanId: parts.spanId,
  traceFlags: parts.traceFlags,
  ...traceStateEntryOf(parts.traceState),
  isRemote: false,
})

export const TraceContextPartsFromSpanContext: S.Codec<TraceContextParts, api.SpanContext> = SpanContext.pipe(
  S.decodeTo(
    Parts,
    SchemaTransformation.transformEffect({
      decode: (context, options) =>
        Boolean.match(api.isValidTraceId(context.traceId) && api.isValidSpanId(context.spanId), {
          onTrue: () =>
            Effect.succeed({
              version: CURRENT_VERSION,
              traceId: context.traceId,
              spanId: context.spanId,
              traceFlags: context.traceFlags,
              ...traceStateFieldOf(context.traceState),
            }),
          onFalse: () =>
            Effect.fail(new SchemaIssue.InvalidValue({ expected: 'a valid W3C span context' }, context, options)),
        }),
      encode: (parts) => Effect.succeed(spanContextOf(parts)),
    }),
  ),
)

export const TraceContextPartsFromEffectSpan: S.Codec<TraceContextParts, EffectSpanIdentity> = EffectSpanShape.pipe(
  S.decodeTo(
    Parts,
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

if (import.meta.vitest !== void 0) {
  const { it } = await import('@effect/vitest')
  const { Arbitrary } = await import('effect/unstable/arbitrary/Arbitrary')

  const hexIdOf = (length: number) =>
    Arbitrary.map(Arbitrary.schema(S.Int), (draw) => Math.abs(draw % 0xfffff).toString(16).padStart(length, '0'))

  const traceIdArbitrary = hexIdOf(32)
  const spanIdArbitrary = hexIdOf(16)
  const flagsArbitrary = Arbitrary.schema(S.Int)
  const sampledArbitrary = Arbitrary.schema(S.Boolean)
  const traceStateArbitrary = Arbitrary.map(
    Arbitrary.schema(S.Literals(['absent', 'k=v', 'a=1,b=2', 'x=y,z=w'])),
    (pick) =>
      Boolean.match(pick === 'absent', {
        onTrue: () => Option.none<string>(),
        onFalse: () => Option.some(pick),
      }),
  )

  const contextFixture = (traceId: string, spanId: string, traceFlags: number, traceState: Option.Option<string>) => ({
    traceId,
    spanId,
    traceFlags,
    ...Option.match(Option.map(traceState, (state) => api.createTraceState(state)), {
      onNone: () => ({}),
      onSome: (state) => ({ traceState: state }),
    }),
    isRemote: false,
  })

  const serializedEqual = (left: api.TraceState | undefined, right: api.TraceState | undefined) =>
    Option.match(Option.all([Option.fromUndefinedOr(left), Option.fromUndefinedOr(right)]), {
      onNone: () => left === right,
      onSome: ([first, second]) => first.serialize() === second.serialize(),
    })

  it.prop(
    '∀trace_span_flags_state_SpanContext→Parts_IdentityConserved',
    [traceIdArbitrary, spanIdArbitrary, flagsArbitrary, traceStateArbitrary],
    ([traceId, spanId, traceFlags, traceState]) => {
      const context = contextFixture(traceId, spanId, traceFlags, traceState)
      return Option.match(S.decodeOption(TraceContextPartsFromSpanContext)(context), {
        onNone: () => false,
        onSome: (parts) =>
          parts.version === '00' &&
          parts.traceId === traceId &&
          parts.spanId === spanId &&
          parts.traceFlags === traceFlags &&
          Option.match(S.encodeOption(TraceContextPartsFromSpanContext)(parts), {
            onNone: () => false,
            onSome: (rebuilt) =>
              rebuilt.traceId === traceId &&
              rebuilt.spanId === spanId &&
              rebuilt.traceFlags === traceFlags &&
              rebuilt.isRemote === false &&
              serializedEqual(rebuilt.traceState, context.traceState),
          }),
      })
    },
  )

  const zeroed = (id: string) => id.replaceAll(/[1-9a-f]/gu, '0')
  const shortened = (id: string) => id.slice(1)

  it.prop(
    '∀trace_span_flags_state_InvalidSpanContext_DecodeNone',
    [traceIdArbitrary, spanIdArbitrary, flagsArbitrary, traceStateArbitrary],
    ([traceId, spanId, traceFlags, traceState]) => {
      const context = contextFixture(traceId, spanId, traceFlags, traceState)
      return [
        Option.isNone(S.decodeOption(TraceContextPartsFromSpanContext)({ ...context, traceId: zeroed(traceId) })),
        Option.isNone(S.decodeOption(TraceContextPartsFromSpanContext)({ ...context, traceId: shortened(traceId) })),
        Option.isNone(S.decodeOption(TraceContextPartsFromSpanContext)({ ...context, spanId: zeroed(spanId) })),
        Option.isNone(S.decodeOption(TraceContextPartsFromSpanContext)({ ...context, spanId: shortened(spanId) })),
      ].every((refused) => refused)
    },
  )

  it.prop(
    '∀trace_span_sampled_EffectSpan→Parts_VersionPinned∧SampledRoundtrips',
    [traceIdArbitrary, spanIdArbitrary, sampledArbitrary],
    ([traceId, spanId, sampled]) =>
      Option.match(S.decodeOption(TraceContextPartsFromEffectSpan)({ traceId, spanId, sampled }), {
        onNone: () => false,
        onSome: (parts) =>
          parts.version === '00' &&
          Option.match(S.encodeOption(TraceContextPartsFromEffectSpan)(parts), {
            onNone: () => false,
            onSome: (span) => span.traceId === traceId && span.spanId === spanId && span.sampled === sampled,
          }),
      })
  )
}
