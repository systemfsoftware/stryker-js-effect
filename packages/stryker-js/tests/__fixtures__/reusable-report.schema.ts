import * as Option from 'effect/Option'
import * as S from 'effect/Schema'

export const ReusableReportSchema = S.Struct({
  dryRunCoverage: S.optional(S.Struct({
    mutantCoverage: S.optional(S.Struct({
      perTest: S.Record(S.String, S.Record(S.String, S.Finite)),
      static: S.Record(S.String, S.Finite),
    })),
    testClosureDigest: S.optional(S.String),
  })),
})

export type ReusableReport = typeof ReusableReportSchema.Type

export const reusableReportOf = (text: string): ReusableReport | undefined =>
  Option.getOrUndefined(S.decodeOption(S.fromJsonString(ReusableReportSchema))(text))
