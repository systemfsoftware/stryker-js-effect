import * as S from 'effect/Schema'

export const CostsFieldSchema = S.StructWithRest(
  S.Struct({
    costs: S.Record(S.String, S.Struct({ predictedMs: S.Finite, actualMs: S.NullOr(S.Finite) })).pipe(S.optional),
  }),
  [S.Record(S.String, S.Json)],
)

export type CostsField = typeof CostsFieldSchema.Type
