import * as api from '@opentelemetry/api'
import * as Boolean from 'effect/Boolean'
import * as Effect from 'effect/Effect'
import * as Option from 'effect/Option'
import * as S from 'effect/Schema'
import * as SchemaGetter from 'effect/SchemaGetter'
import * as SchemaIssue from 'effect/SchemaIssue'
import * as SchemaTransformation from 'effect/SchemaTransformation'

import { TraceContextPartsSchema } from '@systemfsoftware/stryker-js-plugin-interface'
import type { TraceContextParts } from '@systemfsoftware/stryker-js-plugin-interface'

const CURRENT_VERSION = '00'
const SAMPLED_FLAG = 0x01

const EffectSpanShape = S.Struct({
  traceId: S.String,
  spanId: S.String,
  sampled: S.Boolean,
})
export type EffectSpanIdentity = S.Schema.Type<typeof EffectSpanShape>

const SpanContextRecord = S.declare<api.SpanContext>(S.is(S.Struct({
  traceId: S.String,
  spanId: S.String,
  traceFlags: S.Finite,
})), {
  message: 'expected an OpenTelemetry span context',
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

const malformedSpanContext = (context: api.SpanContext) =>
  new SchemaIssue.InvalidValue({ message: 'expected a valid W3C span context' }, context)

const sampledFlagOf = (sampled: boolean) =>
  Boolean.match(sampled, { onTrue: () => SAMPLED_FLAG, onFalse: () => 0 })

const sampledOf = (traceFlags: number) => (traceFlags & SAMPLED_FLAG) === SAMPLED_FLAG

export const TraceContextPartsFromSpanContext: S.Codec<TraceContextParts, api.SpanContext> = SpanContext.pipe(
  S.decodeTo(
    TraceContextPartsSchema,
    SchemaTransformation.makeTransformation({
      decode: SchemaGetter.transformEffect((context: api.SpanContext) =>
        Boolean.match(api.isValidTraceId(context.traceId) && api.isValidSpanId(context.spanId), {
          onTrue: () =>
            Effect.succeed({
              version: CURRENT_VERSION,
              traceId: context.traceId,
              spanId: context.spanId,
              traceFlags: context.traceFlags,
              ...traceStateFieldOf(context.traceState),
            }),
          onFalse: () => Effect.fail(malformedSpanContext(context)),
        })),
      encode: SchemaGetter.forbiddenEncoding,
    }),
  ),
)

export const TraceContextPartsFromEffectSpan: S.Codec<TraceContextParts, EffectSpanIdentity> = EffectSpanShape.pipe(
  S.decodeTo(
    TraceContextPartsSchema,
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
  const fc = await import('fast-check')

  const nonZeroHex = /^[1-9a-f][0-9a-f]*$/

  const traceIdArbitrary = fc.stringMatching(/^[0-9a-f]{32}$/).filter((id) => nonZeroHex.test(id))
  const spanIdArbitrary = fc.stringMatching(/^[0-9a-f]{16}$/).filter((id) => nonZeroHex.test(id))
  const flagsArbitrary = fc.integer()
  const sampledArbitrary = fc.boolean()
  const traceStateArbitrary = fc.option(fc.constantFrom('k=v', 'a=1,b=2', 'x=y,z=w'))

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

  const conservedSpanIdentity = (traceId: string, spanId: string, traceFlags: number) => (parts: TraceContextParts) =>
    parts.traceId === traceId && parts.spanId === spanId && parts.traceFlags === traceFlags

  const conservedState = (traceState: Option.Option<string>) => (parts: TraceContextParts) =>
    parts.traceState === Option.getOrUndefined(Option.map(traceState, (state) => state))

  const conservedIdentity =
    (traceId: string, spanId: string, traceFlags: number, traceState: Option.Option<string>) =>
    (parts: TraceContextParts) =>
      parts.version === '00' &&
      conservedSpanIdentity(traceId, spanId, traceFlags)(parts) &&
      conservedState(traceState)(parts)

  it.prop(
    '∀trace_span_flags_state_SpanContext→Parts_IdentityConserved',
    [traceIdArbitrary, spanIdArbitrary, flagsArbitrary, traceStateArbitrary],
    ([traceId, spanId, traceFlags, traceState]) =>
      Option.match(
        S.decodeOption(TraceContextPartsFromSpanContext)(contextFixture(traceId, spanId, traceFlags, traceState)),
        {
          onNone: () => false,
          onSome: conservedIdentity(traceId, spanId, traceFlags, traceState),
        },
      ),
  )

  const invalidTraceIdArbitrary = fc.oneof(
    fc.constant('0'.repeat(32)),
    fc.stringMatching(/^[0-9a-f]{31}$/),
    fc.stringMatching(/^[0-9a-f]{33}$/),
    fc.stringMatching(/^[0-9A-F]{32}$/),
    fc.stringMatching(/^[0-9a-f]{31}g$/),
  )

  const invalidSpanIdArbitrary = fc.oneof(
    fc.constant('0'.repeat(16)),
    fc.stringMatching(/^[0-9a-f]{15}$/),
    fc.stringMatching(/^[0-9a-f]{17}$/),
    fc.stringMatching(/^[0-9A-F]{16}$/),
    fc.stringMatching(/^[0-9a-f]{15}g$/),
  )

  it.prop(
    '∀trace_span_flags_state_InvalidSpanContext_DecodeNone',
    [traceIdArbitrary, spanIdArbitrary, flagsArbitrary, traceStateArbitrary, invalidTraceIdArbitrary, invalidSpanIdArbitrary],
    ([traceId, spanId, traceFlags, traceState, badTraceId, badSpanId]) => {
      const context = contextFixture(traceId, spanId, traceFlags, traceState)
      return [
        Option.isNone(S.decodeOption(TraceContextPartsFromSpanContext)({ ...context, traceId: badTraceId })),
        Option.isNone(S.decodeOption(TraceContextPartsFromSpanContext)({ ...context, spanId: badSpanId })),
      ].every((refused) => refused)
    },
  )

  const pinnedVersionOf = (decoded: Option.Option<TraceContextParts>) =>
    Option.match(decoded, {
      onNone: () => false,
      onSome: (parts) => parts.version === '00',
    })

  const decodeSpan = (traceId: string, spanId: string, sampled: boolean) =>
    S.decodeOption(TraceContextPartsFromEffectSpan)({ traceId, spanId, sampled })

  const spanRoundtrips = (traceId: string, spanId: string, sampled: boolean) => (parts: TraceContextParts) =>
    Option.match(S.encodeOption(TraceContextPartsFromEffectSpan)(parts), {
      onNone: () => false,
      onSome: (span) => span.traceId === traceId && span.spanId === spanId && span.sampled === sampled,
    })

  const versionPinnedRoundtrips = (traceId: string, spanId: string, sampled: boolean) =>
    pinnedVersionOf(decodeSpan(traceId, spanId, sampled)) &&
    Option.match(decodeSpan(traceId, spanId, sampled), {
      onNone: () => false,
      onSome: spanRoundtrips(traceId, spanId, sampled),
    })

  it.prop(
    '∀trace_span_sampled_EffectSpan→Parts_VersionPinned∧SampledRoundtrips',
    [traceIdArbitrary, spanIdArbitrary, sampledArbitrary],
    ([traceId, spanId, sampled]) => versionPinnedRoundtrips(traceId, spanId, sampled),
  )

  const spanMatches = (traceId: string, spanId: string, traceFlags: number) => (span: EffectSpanIdentity) =>
    span.traceId === traceId && span.spanId === spanId && span.sampled === (traceFlags === 1)

  const spanIdentityOf = (traceId: string, spanId: string, traceFlags: number) => (parts: TraceContextParts) =>
    Option.match(S.encodeOption(TraceContextPartsFromEffectSpan)(parts), {
      onNone: () => false,
      onSome: spanMatches(traceId, spanId, traceFlags),
    })

  it.prop(
    '∀id_flags_state_Parts→Span_IdentityConserved',
    [traceIdArbitrary, spanIdArbitrary, flags01Arbitrary, traceStateArbitrary],
    ([traceId, spanId, traceFlags, traceState]) =>
      spanIdentityOf(traceId, spanId, traceFlags)(partsFixture(traceId, spanId, traceFlags, traceState)),
  )
}
