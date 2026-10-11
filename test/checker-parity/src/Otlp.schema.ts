import * as S from 'effect/Schema'

export const AttributeValue = S.Struct({
  stringValue: S.optional(S.String),
  intValue: S.optional(S.Union([S.String, S.Finite])),
  doubleValue: S.optional(S.Finite),
  boolValue: S.optional(S.Boolean),
})

export const KeyValue = S.Struct({ key: S.String, value: AttributeValue })

export const KeyValues = S.Array(KeyValue)

export const Span = S.Struct({
  name: S.String,
  attributes: S.optional(KeyValues),
})

export const ScopeSpans = S.Struct({ spans: S.Array(Span) })

export const Resource = S.Struct({ attributes: S.optional(KeyValues) })

export const ResourceSpans = S.Struct({
  resource: S.optional(Resource),
  scopeSpans: ScopeSpans.pipe(S.Array, S.optional),
})

export const OtlpExportRequest = S.Struct({ resourceSpans: S.Array(ResourceSpans) })
