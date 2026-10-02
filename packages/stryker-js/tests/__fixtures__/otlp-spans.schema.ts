import * as S from 'effect/Schema'

const AttributeValue = S.Struct({
  stringValue: S.optional(S.String),
  intValue: S.optional(S.Union([S.String, S.Finite])),
})

const Attribute = S.Struct({ key: S.String, value: AttributeValue })

export const OtlpSpan = S.Struct({ name: S.String, traceId: S.String, attributes: S.Array(Attribute) })
export type OtlpSpan = typeof OtlpSpan.Type

const ScopeSpans = S.Struct({ spans: OtlpSpan.pipe(S.Array, S.optional) })
const ResourceSpans = S.Struct({ scopeSpans: ScopeSpans.pipe(S.Array, S.optional) })

export const OtlpPayload = S.Struct({ resourceSpans: ResourceSpans.pipe(S.Array, S.optional) })
export type OtlpPayload = typeof OtlpPayload.Type
