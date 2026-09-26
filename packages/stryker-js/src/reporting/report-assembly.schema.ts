import { Mutant } from '@systemfsoftware/stryker-js-instrumenter'
import * as S from 'effect/Schema'

export const MutationReportFileName = S.Literal('mutation-report.json')
export const MutationPartFileName = S.Literal('mutation-part.json')
export const MutationStreamFileName = S.Literal('mutation-stream.jsonl')

export const ReportFileNames = S.Record(S.String, Mutant.CanonicalFileName)
export type ReportFileNames = typeof ReportFileNames.Type
