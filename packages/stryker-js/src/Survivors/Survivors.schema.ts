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
          id: S.String,
          mutatorName: S.String,
          replacement: S.optional(S.String),
          status: S.String,
          location: S.Struct({
            start: S.Struct({ line: S.Finite, column: S.Finite }),
            end: S.Struct({ line: S.Finite, column: S.Finite }),
          }),
        }),
      ),
    }),
  ),
})

export type PriorReportDocument = S.Schema.Type<typeof PriorReportDocument>
export type PriorReportMutant = PriorReportDocument['files'][string]['mutants'][number]
