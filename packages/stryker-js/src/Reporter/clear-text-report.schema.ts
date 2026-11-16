import { Workflow } from '@systemfsoftware/effect-cell-types'
import { Report } from '@systemfsoftware/stryker-js-plugin-interface'
import * as S from 'effect/Schema'

export interface FileScore {
  readonly name: string
  readonly killed: number
  readonly timeout: number
  readonly survived: number
  readonly noCoverage: number
  readonly invalid: number
  readonly mutationScore: Report.MutationScore
  readonly mutationScoreBasedOnCoveredCode: Report.MutationScore
  readonly childResults: readonly FileScore[]
}

export const FileScoreSchema: S.Codec<FileScore> = S.Struct({
  name: S.String,
  killed: Report.NonNegativeInt,
  timeout: Report.NonNegativeInt,
  survived: Report.NonNegativeInt,
  noCoverage: Report.NonNegativeInt,
  invalid: Report.NonNegativeInt,
  mutationScore: Report.MutationScore,
  mutationScoreBasedOnCoveredCode: Report.MutationScore,
  childResults: S.Array(S.suspend((): S.Codec<FileScore> => FileScoreSchema)),
})

export const ReportedMutant = S.Struct({
  fileName: S.String,
  source: S.String,
  mutant: Report.MutantResult,
})
export type ReportedMutant = typeof ReportedMutant.Type

export const ClearTextSummarySchema = S.Struct({
  scores: FileScoreSchema,
  totalMutants: Report.NonNegativeFinite,
  testsCompleted: Report.NonNegativeFinite,
  undetected: S.Array(ReportedMutant),
  static: S.optional(Report.StaticClassSummarySchema),
})
export type ClearTextSummary = typeof ClearTextSummarySchema.Type

export class ClearTextReportCommand
  extends S.TaggedClass<ClearTextReportCommand, { readonly brand: unique symbol }>()('ClearTextReportCommand', {
    reported: S.optional(Report.MutationTestResult),
    computed: S.optional(Report.MetricsResultSchema),
    static: S.optional(Report.StaticClassSummarySchema),
    debug: S.Boolean,
  })
{
  static readonly [Workflow.InstrumentationBrand] = {} as const
}
