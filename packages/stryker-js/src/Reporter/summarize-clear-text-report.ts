import { type Mutant, Report } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Arr from 'effect/Array'
import * as Boolean from 'effect/Boolean'
import * as Option from 'effect/Option'
import * as S from 'effect/Schema'

import type { ClearTextReportCommand, ClearTextSummary, FileScore, ReportedMutant } from './clear-text-report.schema.js'
import { type ClearTextRenderOptions, renderClearTextReport, renderSettledMutants } from './render-clear-text-report.js'

export interface ClearTextOutput {
  readonly stdout: readonly string[]
  readonly stderr: readonly string[]
}

const isUndetected = S.is(Report.UndetectedStatus)

const isSettled = S.is(S.Union([Report.DetectedStatus, Report.InvalidStatus]))

const reportedMutantsOf = (report: Report.MutationTestResult): readonly ReportedMutant[] =>
  Object.entries(report.files).flatMap(([fileName, file]) =>
    file.mutants.map((mutant) => ({ fileName, source: file.source, mutant }))
  )

const withStatus = (
  mutants: readonly ReportedMutant[],
  admits: (status: Mutant.MutantStatus) => boolean,
): readonly ReportedMutant[] => mutants.filter((reported) => admits(reported.mutant.status))

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

export const summarizeClearTextReport = (
  { report, metrics, staticSummary }: {
    readonly report: Report.MutationTestResult
    readonly metrics: Report.MetricsResult
    readonly staticSummary: Report.StaticClassSummary | undefined
  },
): ClearTextSummary => {
  const mutants = reportedMutantsOf(report)
  return {
    scores: fileScoreOf(metrics),
    totalMutants: metrics.metrics.totalMutants,
    testsCompleted: testsCompletedBy(mutants),
    undetected: withStatus(mutants, isUndetected),
    static: staticSummary,
  }
}

export const settledMutantsOf = (report: Report.MutationTestResult): readonly ReportedMutant[] =>
  withStatus(reportedMutantsOf(report), isSettled)

const settledOutputOf = (
  debug: boolean,
  report: Report.MutationTestResult,
  render: ClearTextRenderOptions,
): readonly string[] =>
  Boolean.match(debug, {
    onTrue: () => renderSettledMutants({ settled: settledMutantsOf(report), render }),
    onFalse: () => [],
  })

export const clearTextOutputOf = (
  { command, render }: { readonly command: ClearTextReportCommand; readonly render: ClearTextRenderOptions },
): ClearTextOutput =>
  Option.match(
    Option.all([Option.fromUndefinedOr(command.reported), Option.fromUndefinedOr(command.computed)]),
    {
      onNone: (): ClearTextOutput => ({ stdout: [], stderr: [] }),
      onSome: ([report, metrics]): ClearTextOutput => ({
        stdout: renderClearTextReport({
          summary: summarizeClearTextReport({ report, metrics, staticSummary: command.static }),
          render,
        }),
        stderr: settledOutputOf(command.debug, report, render),
      }),
    },
  )

if (import.meta.vitest !== void 0) {
  const { it } = await import('@systemfsoftware/vitest')

  const summaryInputSchema = S.Struct({
    report: Report.MutationTestResult,
    metrics: Report.MetricsResultSchema,
    staticSummary: S.UndefinedOr(Report.StaticClassSummarySchema),
  })

  const reportedEntries = (report: Report.MutationTestResult): readonly ReportedMutant[] =>
    Object.entries(report.files).flatMap(([fileName, file]) =>
      file.mutants.map((mutant) => ({ fileName, source: file.source, mutant }))
    )

  const identityOf = (entry: ReportedMutant): string => JSON.stringify([entry.fileName, entry.mutant.id])

  it.prop(
    '∀rm_Summary_≡SettledUndetectedPartition',
    {
      of: [summaryInputSchema],
      subject: summarizeClearTextReport,
      cover: {
        classified: [
          (input) =>
            reportedEntries(input.report).some((entry) =>
              entry.mutant.status !== 'Ignored' && entry.mutant.status !== 'Pending'
            ),
          0.05,
        ],
      },
    },
    (subject, [input]) => {
      const expected = reportedEntries(input.report)
        .filter((entry) => entry.mutant.status !== 'Ignored' && entry.mutant.status !== 'Pending')
        .map(identityOf)
        .sort()
      const actual = [...subject(input).undetected, ...settledMutantsOf(input.report)]
        .map(identityOf)
        .sort()
      return actual.length === expected.length && actual.every((identity, index) => identity === expected[index])
    },
  )
}
