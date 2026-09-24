import * as S from 'effect/Schema'

const Status = S.Union([S.Literal('Killed'), S.Literal('Timeout'), S.Literal('Ignored')])
const MutantView = S.Struct({
  status: Status,
  killedBy: S.optional(S.Array(S.String)),
  coveredBy: S.optional(S.Array(S.String)),
})
const FileView = S.Struct({ mutants: S.Array(MutantView) })
const TestFileView = S.Struct({ tests: S.Array(S.Struct({ id: S.String })) })
const LawsReport = S.Struct({
  files: S.Record(S.String, FileView),
  testFiles: S.optional(S.Record(S.String, TestFileView)),
})
export const LawsCommand = S.Struct({
  report: LawsReport,
  everyKillerRecorded: S.Boolean,
  suffixes: S.Array(S.String),
})
export type LawsCommand = typeof LawsCommand.Type
