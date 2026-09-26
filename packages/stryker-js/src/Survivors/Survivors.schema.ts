import { Mutant } from '@systemfsoftware/stryker-js-instrumenter'
import * as S from 'effect/Schema'

export const PriorReportDocument = S.Struct({
  config: S.optional(S.Record(S.String, S.Unknown)),
  framework: S.optional(S.Struct({ version: S.optional(S.String) })),
  files: S.Record(
    S.String,
    S.Struct({
      source: S.String,
      mutants: S.Array(
        S.Struct({
          id: Mutant.MutantId,
          mutatorName: S.String,
          replacement: S.optional(S.String),
          status: Mutant.MutantStatusSchema,
          location: Mutant.Location,
        }),
      ),
    }),
  ),
})

export type PriorReportDocument = S.Schema.Type<typeof PriorReportDocument>
export type PriorReportMutant = PriorReportDocument['files'][string]['mutants'][number]
