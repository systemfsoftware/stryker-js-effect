import { Report } from '@systemfsoftware/stryker-js-plugin-interface'
import * as S from 'effect/Schema'

export const ReportMutant = S.Struct({ file: S.String, mutant: Report.MutantResult })
export type ReportMutant = typeof ReportMutant.Type
