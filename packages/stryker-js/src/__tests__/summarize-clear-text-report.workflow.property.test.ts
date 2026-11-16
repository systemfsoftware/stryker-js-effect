import { Report } from '@systemfsoftware/stryker-js-plugin-interface'
import { describe, it } from '@systemfsoftware/vitest'
import * as Arbitrary from 'effect/Arbitrary'
import * as Match from 'effect/Match'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import {
  ClearTextReportCommand,
  ClearTextReportDecision,
  ClearTextReportDetailed,
  ClearTextReportSummarized,
  type FileScore,
  type ReportedMutant,
  summarizeClearTextReport,
} from '../Reporter/summarize-clear-text-report.workflow.js'

const UNDETECTED_STATUSES: ReadonlyArray<string> = ['Survived', 'NoCoverage']
const SETTLED_STATUSES: ReadonlyArray<string> = ['Killed', 'Timeout', 'RuntimeError', 'CompileError']
const UNTESTED_STATUSES: ReadonlyArray<string> = ['Ignored', 'Pending']

const commandArb = Arbitrary.all({
  reported: Arbitrary.schema(ClearTextReportCommand.fields.reported),
  computed: Arbitrary.schema(ClearTextReportCommand.fields.computed),
  static: Arbitrary.schema(ClearTextReportCommand.fields.static),
  debug: Arbitrary.schema(ClearTextReportCommand.fields.debug),
}).pipe(Arbitrary.map((fields) => ClearTextReportCommand.make(fields)))

const presentCommandArb = Arbitrary.all({
  reported: Arbitrary.schema(Report.MutationTestResult),
  computed: Arbitrary.schema(Report.MetricsResultSchema),
  static: Arbitrary.schema(ClearTextReportCommand.fields.static),
  debug: Arbitrary.schema(ClearTextReportCommand.fields.debug),
}).pipe(Arbitrary.map((fields) => ClearTextReportCommand.make(fields)))

const isPresent = (command: ClearTextReportCommand): boolean =>
  command.reported !== undefined && command.computed !== undefined

const expectedTag = (command: ClearTextReportCommand): string =>
  isPresent(command)
    ? (command.debug ? 'ClearTextReportDetailed' : 'ClearTextReportSummarized')
    : 'ClearTextReportSuppressed'

const tagOf = (decision: ClearTextReportDecision): string =>
  Match.valueTags(decision, {
    ClearTextReportSummarized: () => 'ClearTextReportSummarized',
    ClearTextReportDetailed: () => 'ClearTextReportDetailed',
    ClearTextReportSuppressed: () => 'ClearTextReportSuppressed',
  })

const reportedWith = (report: Report.MutationTestResult, statuses: ReadonlyArray<string>): ReportedMutant[] =>
  Object.entries(report.files).flatMap(([fileName, file]) =>
    file.mutants.filter((mutant) => statuses.includes(mutant.status)).map((mutant) => ({
      fileName,
      source: file.source,
      mutant,
    }))
  )

const testsCompletedIn = (report: Report.MutationTestResult): number =>
  Object.values(report.files)
    .flatMap((file) => file.mutants)
    .reduce((total, mutant) => total + (mutant.testsCompleted ?? 0), 0)

const scoreOf = (detected: number, counted: number): Report.MutationScore =>
  counted > 0
    ? Report.MutationScore.cases.Scored.make({ percentage: (detected / counted) * 100 })
    : Report.MutationScore.cases.Unscored.make({})

const expectedScores = (row: Report.MetricsResult): FileScore => {
  const { killed, timeout, survived, noCoverage, runtimeErrors, compileErrors } = row.metrics
  return {
    name: row.name,
    killed,
    timeout,
    survived,
    noCoverage,
    invalid: runtimeErrors + compileErrors,
    mutationScore: scoreOf(killed + timeout, killed + timeout + survived + noCoverage),
    mutationScoreBasedOnCoveredCode: scoreOf(killed + timeout, killed + timeout + survived),
    childResults: row.childResults.map(expectedScores),
  }
}

const totalMutantsOf = (metrics: Report.Metrics): number =>
  metrics.pending + metrics.killed + metrics.timeout + metrics.survived + metrics.noCoverage +
  metrics.runtimeErrors + metrics.compileErrors + metrics.ignored

const expectedDecision = (
  report: Report.MutationTestResult,
  metrics: Report.MetricsResult,
  command: ClearTextReportCommand,
): ClearTextReportDecision => {
  const summary = {
    scores: expectedScores(metrics),
    totalMutants: totalMutantsOf(metrics.metrics),
    testsCompleted: testsCompletedIn(report),
    undetected: reportedWith(report, UNDETECTED_STATUSES),
    static: command.static,
  }
  return command.debug
    ? ClearTextReportDetailed.make({ ...summary, settled: reportedWith(report, SETTLED_STATUSES) })
    : ClearTextReportSummarized.make(summary)
}

const statusesIn = (command: ClearTextReportCommand): ReadonlyArray<string> =>
  Object.values(command.reported?.files ?? {}).flatMap((file) => file.mutants.map((mutant) => mutant.status))

const drawsStatusIn = (command: ClearTextReportCommand, statuses: ReadonlyArray<string>): boolean =>
  statusesIn(command).some((status) => statuses.includes(status))

describe('summarizeClearTextReport', () => {
  it.prop(
    '∀c_Command_≡TagTable',
    {
      of: [commandArb],
      subject: summarizeClearTextReport,
      cover: {
        noReport: [(command) => command.reported === undefined, 0.05],
        noMetrics: [(command) => command.reported !== undefined && command.computed === undefined, 0.05],
      },
    },
    (subject, [command]) =>
      Result.match(subject(command), {
        onFailure: () => false,
        onSuccess: (decision) => tagOf(decision) === expectedTag(command),
      }),
  )

  it.prop(
    '∀c_PresentReport_≡SummaryPayload',
    {
      of: [presentCommandArb],
      subject: summarizeClearTextReport,
      cover: {
        undetected: [(command) => drawsStatusIn(command, UNDETECTED_STATUSES), 0.05],
        settled: [(command) => drawsStatusIn(command, SETTLED_STATUSES), 0.05],
        untested: [(command) => drawsStatusIn(command, UNTESTED_STATUSES), 0.05],
        staticSupplied: [(command) => command.static !== undefined, 0.05],
        staticAbsent: [(command) => command.static === undefined, 0.05],
        debug: [(command) => command.debug, 0.05],
        quiet: [(command) => !command.debug, 0.05],
      },
    },
    (subject, [command]) =>
      Result.match(subject(command), {
        onFailure: () => false,
        onSuccess: (decision) =>
          command.reported !== undefined && command.computed !== undefined &&
          S.toEquivalence(ClearTextReportDecision)(
            decision,
            expectedDecision(command.reported, command.computed, command),
          ),
      }),
  )
})
