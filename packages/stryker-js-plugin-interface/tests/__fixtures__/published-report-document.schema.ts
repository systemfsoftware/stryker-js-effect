import * as S from 'effect/Schema'

const PublishedThreshold = S.Struct({ type: S.String, minimum: S.optional(S.Finite), maximum: S.optional(S.Finite) })

export const PublishedBreakThresholdSchema = S.Struct({
  description: S.String,
  anyOf: S.Array(PublishedThreshold),
})
export type PublishedBreakThreshold = typeof PublishedBreakThresholdSchema.Type

export const PublishedReportDocumentSchema = S.Struct({
  definitions: S.Struct({
    thresholds: S.Struct({ properties: S.Struct({ break: PublishedBreakThresholdSchema }) }),
  }),
})
export type PublishedReportDocument = typeof PublishedReportDocumentSchema.Type
