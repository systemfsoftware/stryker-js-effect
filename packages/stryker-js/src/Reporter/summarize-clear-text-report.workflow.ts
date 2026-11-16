import { Workflow } from '@systemfsoftware/effect-cell-types'
import { type Mutant, Report } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Arr from 'effect/Array'
import * as Boolean from 'effect/Boolean'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

const ClearTextReportTypeId: unique symbol = Symbol.for('@systemfsoftware/stryker-js/ClearTextReport')
type ClearTextReportTypeId = typeof ClearTextReportTypeId

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
  killed: S.Finite,
  timeout: S.Finite,
  survived: S.Finite,
  noCoverage: S.Finite,
  invalid: S.Finite,
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

const summaryFields = {
  scores: FileScoreSchema,
  totalMutants: S.Finite,
  testsCompleted: S.Finite,
  undetected: S.Array(ReportedMutant),
  static: S.optional(Report.StaticClassSummarySchema),
}

export class ClearTextReportSummarized
  extends S.TaggedClass<ClearTextReportSummarized, { readonly brand: unique symbol }>()(
    'ClearTextReportSummarized',
    summaryFields,
  )
{
  readonly [ClearTextReportTypeId] = ClearTextReportTypeId
}

export class ClearTextReportDetailed
  extends S.TaggedClass<ClearTextReportDetailed, { readonly brand: unique symbol }>()('ClearTextReportDetailed', {
    ...summaryFields,
    settled: S.Array(ReportedMutant),
  })
{
  readonly [ClearTextReportTypeId] = ClearTextReportTypeId
}

export class ClearTextReportSuppressed
  extends S.TaggedClass<ClearTextReportSuppressed, { readonly brand: unique symbol }>()('ClearTextReportSuppressed', {})
{
  readonly [ClearTextReportTypeId] = ClearTextReportTypeId
}

export const ClearTextReportDecision = S.Union([
  ClearTextReportSummarized,
  ClearTextReportDetailed,
  ClearTextReportSuppressed,
])
export type ClearTextReportDecision = typeof ClearTextReportDecision.Type

const isUndetected = S.is(Report.UndetectedStatus)

const isSettled = S.is(S.Union([Report.DetectedStatus, Report.InvalidStatus]))

const reportedMutantsOf = (report: Report.MutationTestResult): readonly ReportedMutant[] =>
  Object.entries(report.files).flatMap(([fileName, file]) =>
    file.mutants.map((mutant) => ({ fileName, source: file.source, mutant }))
  )

const withStatus = (
  mutants: readonly ReportedMutant[],
  admits: (status: Mutant.MutantStatus) => boolean,
): ReportedMutant[] => mutants.filter((reported) => admits(reported.mutant.status))

const testsCompletedBy = (mutants: readonly ReportedMutant[]): number =>
  Arr.reduce(
    mutants,
    0,
    (total, reported) => total + Option.getOrElse(Option.fromUndefinedOr(reported.mutant.testsCompleted), () => 0),
  )

const fileScoreOf = (row: Report.MetricsResult): FileScore => ({
  name: row.name,
  killed: row.metrics.killed,
  timeout: row.metrics.timeout,
  survived: row.metrics.survived,
  noCoverage: row.metrics.noCoverage,
  invalid: row.metrics.totalInvalid,
  mutationScore: row.metrics.mutationScore,
  mutationScoreBasedOnCoveredCode: row.metrics.mutationScoreBasedOnCoveredCode,
  childResults: row.childResults.map(fileScoreOf),
})

const summaryOf = (
  report: Report.MutationTestResult,
  metrics: Report.MetricsResult,
  staticSummary: Report.StaticClassSummary | undefined,
) => {
  const mutants = reportedMutantsOf(report)
  return {
    mutants,
    summary: {
      scores: fileScoreOf(metrics),
      totalMutants: metrics.metrics.totalMutants,
      testsCompleted: testsCompletedBy(mutants),
      undetected: withStatus(mutants, isUndetected),
      static: staticSummary,
    },
  }
}

export const summarizeClearTextReport = Workflow.make({
  command: ClearTextReportCommand,
  decision: ClearTextReportDecision,
  error: S.Never,
  decide: (command) =>
    Option.match(
      Option.all([Option.fromUndefinedOr(command.reported), Option.fromUndefinedOr(command.computed)]),
      {
        onNone: () => Result.succeed(ClearTextReportSuppressed.make({})),
        onSome: ([report, metrics]) => {
          const { mutants, summary } = summaryOf(report, metrics, command.static)
          return Result.succeed(Boolean.match(command.debug, {
            onTrue: (): ClearTextReportDecision =>
              ClearTextReportDetailed.make({ ...summary, settled: withStatus(mutants, isSettled) }),
            onFalse: (): ClearTextReportDecision => ClearTextReportSummarized.make(summary),
          }))
        },
      },
    ),
})
