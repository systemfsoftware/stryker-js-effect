import { Mutant } from '@systemfsoftware/stryker-js-plugin-interface'
import * as S from 'effect/Schema'

export const ReportRow = S.Struct({
  id: S.String,
  mutatorName: S.String,
  status: Mutant.MutantStatusSchema,
  statusReason: S.optional(S.String),
  subsumption: S.optional(Mutant.Subsumption),
  location: S.Struct({
    start: S.Struct({ line: S.Finite }),
    end: S.Struct({ line: S.Finite }),
  }),
})
export type ReportRow = typeof ReportRow.Type

export const MutationReport = S.Struct({
  files: S.Record(S.String, S.Struct({ mutants: S.Array(ReportRow) })),
})
