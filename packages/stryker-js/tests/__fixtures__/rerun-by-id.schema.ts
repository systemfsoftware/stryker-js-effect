import * as S from 'effect/Schema'

export const ReproducerList = S.Array(S.Struct({
  id: S.String,
  fileName: S.String,
  diff: S.String,
  command: S.String,
}))

export const ReportSurvivors = S.Struct({
  files: S.Record(
    S.String,
    S.Struct({ mutants: S.Array(S.Struct({ id: S.String, status: S.String })) }),
  ),
})
