import * as Option from 'effect/Option'
import * as S from 'effect/Schema'

export const ReusableReportSchema = S.Struct({
  files: S.Record(
    S.String,
    S.Struct({
      mutants: S.Array(S.Struct({ id: S.String, status: S.String, statusReason: S.optional(S.String) })),
    }),
  ),
  dryRunCoverage: S.optional(S.Struct({
    mutantCoverage: S.optional(S.Struct({
      perTest: S.Record(S.String, S.Record(S.String, S.Finite)),
      static: S.Record(S.String, S.Finite),
    })),
  })),
})

export type ReusableReport = typeof ReusableReportSchema.Type

export const reusableReportOf = (text: string): ReusableReport | undefined =>
  Option.getOrUndefined(S.decodeOption(S.fromJsonString(ReusableReportSchema))(text))
