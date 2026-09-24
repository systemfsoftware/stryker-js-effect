import * as Boolean from 'effect/Boolean'
import * as Option from 'effect/Option'
import * as S from 'effect/Schema'
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

const sampledFlagOf = (sampled: boolean) =>
  Boolean.match(sampled, { onTrue: () => SAMPLED_FLAG, onFalse: () => 0 })

const sampledOf = (traceFlags: number) => (traceFlags & SAMPLED_FLAG) === SAMPLED_FLAG

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
  const Arbitrary = await import('effect/unstable/arbitrary/Arbitrary')

  const traceIdArbitrary = Arbitrary.filter(
    Arbitrary.schema(S.String.check(S.isPattern(/^[0-9a-f]{32}$/))),
    (id) => /^[1-9a-f][0-9a-f]*$/.test(id),
  )
  const spanIdArbitrary = Arbitrary.filter(
    Arbitrary.schema(S.String.check(S.isPattern(/^[0-9a-f]{16}$/))),
    (id) => /^[1-9a-f][0-9a-f]*$/.test(id),
  )
  const sampledArbitrary = Arbitrary.schema(S.Boolean)
  const traceStateArbitrary = Arbitrary.map(
    Arbitrary.schema(S.Literals(['absent', 'k=v', 'a=1,b=2', 'x=y,z=w'])),
    (pick) =>
      Boolean.match(pick === 'absent', {
        onTrue: () => Option.none<string>(),
        onFalse: () => Option.some(pick),
      }),
  )

  const decodeSpan = (traceId: string, spanId: string, sampled: boolean) =>
    S.decodeOption(TraceContextPartsFromEffectSpan)({ traceId, spanId, sampled })

  const sameIds = (traceId: string, spanId: string) => (span: EffectSpanIdentity) =>
    span.traceId === traceId && span.spanId === spanId

  const sameSampled = (sampled: boolean) => (span: EffectSpanIdentity) => span.sampled === sampled

  const spanVerdictOf = (traceId: string, spanId: string, sampled: boolean) => (span: EffectSpanIdentity) =>
    sameIds(traceId, spanId)(span) && sameSampled(sampled)(span)

  const spanRoundtrips = (traceId: string, spanId: string, sampled: boolean) => (parts: TraceContextParts) =>
    Option.match(S.encodeOption(TraceContextPartsFromEffectSpan)(parts), {
      onNone: () => false,
      onSome: spanVerdictOf(traceId, spanId, sampled),
    })

  const pinnedVersionOf = (decoded: Option.Option<TraceContextParts>) =>
    Option.match(decoded, {
      onNone: () => false,
      onSome: (parts) => parts.version === '00',
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

  const flagsIdentityArbitrary = Arbitrary.schema(S.Literals([0, 1]))

  const partsFixture = (
    traceId: string,
    spanId: string,
    traceFlags: number,
    traceState: Option.Option<string>,
  ) => ({
    version: '00',
    traceId,
    spanId,
    traceFlags,
    ...Option.match(traceState, {
      onNone: () => ({}),
      onSome: (state) => ({ traceState: state }),
    }),
  })

  const sampledMatches = (traceFlags: number) => (span: EffectSpanIdentity) => span.sampled === (traceFlags === 1)

  const spanMatches = (traceId: string, spanId: string, traceFlags: number) => (span: EffectSpanIdentity) =>
    sameIds(traceId, spanId)(span) && sampledMatches(traceFlags)(span)

  const spanIdentityOf = (traceId: string, spanId: string, traceFlags: number) => (parts: TraceContextParts) =>
    Option.match(S.encodeOption(TraceContextPartsFromEffectSpan)(parts), {
      onNone: () => false,
      onSome: spanMatches(traceId, spanId, traceFlags),
    })

  it.prop(
    '∀id_flags_state_Parts→Span_IdentityConserved',
    [traceIdArbitrary, spanIdArbitrary, flagsIdentityArbitrary, traceStateArbitrary],
    ([traceId, spanId, traceFlags, traceState]) =>
      spanIdentityOf(traceId, spanId, traceFlags)(partsFixture(traceId, spanId, traceFlags, traceState)),
  )
}
