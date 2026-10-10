import { RunEvent } from '@systemfsoftware/stryker-js-cli-contract'
import { describe, it } from '@systemfsoftware/vitest'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import { BenchReport, BenchReportJson, type BenchReportRun } from '../bench-report.schema.js'
import { BenchRun, BenchRunInvalid, BenchRunKey, BenchRunMeasured } from '../bench-run.schema.js'
import { type BenchSummary, PhaseVerdict } from '../bench-summary.schema.js'
import { renderBenchAnnotation } from '../render-bench-annotation.js'
import { summarizeBench, SummarizeBenchCommand } from '../summarize-bench.workflow.js'

const REPORTING_MEASURED: RunEvent.ReportingDuration = { _tag: 'measured', ms: 0 }

const runFrom = (side: 'A' | 'B', position: number, mutationTest: number, digest = 'digest-entry'): BenchRunMeasured =>
  BenchRunMeasured.make({
    key: BenchRunKey.make({ corpus: 'repo', entry: 'entry', side, position }),
    phaseDurations: {
      prepare: 0,
      instrument: 0,
      'dry-run': 0,
      'mutation-test': mutationTest,
      check: { _tag: 'not-recorded' },
      reporting: REPORTING_MEASURED,
    },
    mutants: 10,
    testsExecuted: 2,
    workloadDigest: digest,
    wallMs: mutationTest,
    exitCode: 0,
  })

const fourRuns = (side: 'A' | 'B', samples: ReadonlyArray<number>): ReadonlyArray<BenchRunMeasured> => [
  runFrom(side, 0, samples[0]),
  runFrom(side, 1, samples[1]),
  runFrom(side, 2, samples[2]),
  runFrom(side, 3, samples[3]),
]

const runsOf = (aSamples: ReadonlyArray<number>, bSamples: ReadonlyArray<number>): ReadonlyArray<BenchRun> => [
  ...fourRuns('A', aSamples),
  ...fourRuns('B', bSamples),
]

const positives = (values: ReadonlyArray<number>): ReadonlyArray<number> => values.map((value) => Math.abs(value) + 1)

const reportRunsOf = (runs: ReadonlyArray<BenchRun>): ReadonlyArray<BenchReportRun> =>
  runs.map((run) => ({ key: run.key, wallMs: 1, exitCode: 0 }))

const summaryOf = (runs: ReadonlyArray<BenchRun>): BenchSummary =>
  Result.getOrThrow(summarizeBench(SummarizeBenchCommand.make({ runs })))

const reportOf = (
  summary: BenchSummary,
  runs: ReadonlyArray<BenchRun>,
  baseSha: string,
  headSha: string,
): BenchReport =>
  BenchReport.make({
    schemaVersion: '1.0',
    baseSha,
    headSha,
    outcome: { _tag: 'summarized', projects: summary.projects },
    runs: reportRunsOf(runs),
    setupSteps: [],
  })

type AnnotationSubject = (report: BenchReport) => string

const lineOf = (subject: AnnotationSubject, report: BenchReport): string => subject(report)

const countOf = (text: string, word: string): number => text.split(` ${word} `).length - 1

const rowCountOf = (summary: BenchSummary, tag: 'improved' | 'regressed'): number =>
  summary.projects.reduce(
    (count, project) => count + project.rows.filter((row) => S.is(PhaseVerdict.cases[tag])(row.verdict)).length,
    0,
  )

const failedReportOf = (reason: string, lineNumber: number | null): BenchReport =>
  BenchReport.make({
    schemaVersion: '1.0',
    baseSha: 'base',
    headSha: 'head',
    outcome: {
      _tag: 'failed',
      invalid: [
        BenchRunInvalid.make({
          key: BenchRunKey.make({ corpus: 'repo', entry: 'entry', side: 'B', position: 4 }),
          reason,
          lineNumber,
        }),
      ],
    },
    runs: [],
    setupSteps: [],
  })

describe('renderBenchAnnotation', () => {
  it.prop(
    '∀ab_Annotation_≡ErrorIffRegressedElseNoticeAndOneLine',
    {
      of: [S.Tuple([S.Int, S.Int, S.Int, S.Int]), S.Tuple([S.Int, S.Int, S.Int, S.Int])],
      subject: renderBenchAnnotation,
    },
    (subject, [rawA, rawB]) => {
      const summary = summaryOf(runsOf(positives(rawA), positives(rawB)))
      const line = lineOf(subject, reportOf(summary, runsOf(positives(rawA), positives(rawB)), 'base', 'head'))
      const regressed = rowCountOf(summary, 'regressed')
      const level = regressed > 0 ? '::error title=Bench regression::' : '::notice title=Bench '
      return line.startsWith(level) && line.includes('\n') === false
    },
  )

  it.prop(
    '∀ab_AnnotationNamesVerdicts_≡CountsMatchTheMarkdown',
    {
      of: [S.Tuple([S.Int, S.Int, S.Int, S.Int]), S.Tuple([S.Int, S.Int, S.Int, S.Int])],
      subject: renderBenchAnnotation,
    },
    (subject, [rawA, rawB]) => {
      const runs = runsOf(positives(rawA), positives(rawB))
      const summary = summaryOf(runs)
      const line = lineOf(subject, reportOf(summary, runs, 'base', 'head'))
      return countOf(line, 'improved') === rowCountOf(summary, 'improved') &&
        countOf(line, 'regressed') === rowCountOf(summary, 'regressed')
    },
  )

  it.prop(
    '∀ab_SidesSwapped_≡ImprovedAndRegressedSwap',
    {
      of: [S.Tuple([S.Int, S.Int, S.Int, S.Int]), S.Tuple([S.Int, S.Int, S.Int, S.Int])],
      subject: renderBenchAnnotation,
    },
    (subject, [rawA, rawB]) => {
      const forward = summaryOf(runsOf(positives(rawA), positives(rawB)))
      const swapped = summaryOf(runsOf(positives(rawB), positives(rawA)))
      const forwardLine = lineOf(subject, reportOf(forward, runsOf(positives(rawA), positives(rawB)), 'base', 'head'))
      const swappedLine = lineOf(subject, reportOf(swapped, runsOf(positives(rawB), positives(rawA)), 'base', 'head'))
      return countOf(forwardLine, 'improved') === countOf(swappedLine, 'regressed') &&
        countOf(forwardLine, 'regressed') === countOf(swappedLine, 'improved')
    },
  )

  it.prop(
    '∀ab_ReportRoundTrip_≡Identity',
    {
      of: [S.Tuple([S.Int, S.Int, S.Int, S.Int]), S.Tuple([S.Int, S.Int, S.Int, S.Int])],
      subject: renderBenchAnnotation,
    },
    (subject, [rawA, rawB]) => {
      const runs = runsOf(positives(rawA), positives(rawB))
      const report = reportOf(summaryOf(runs), runs, 'base', 'head')
      const encoded = Result.getOrThrow(S.encodeResult(BenchReportJson)(report))
      const decoded = Result.getOrThrow(S.decodeResult(BenchReportJson)(encoded))
      return JSON.stringify(decoded) === JSON.stringify(report) && lineOf(subject, decoded) === lineOf(subject, report)
    },
  )

  it.prop(
    '∀rl_FailedOutcome_≡ErrorInvalid',
    { of: [S.NonEmptyString, S.NullOr(S.Int)], subject: renderBenchAnnotation },
    (subject, [reason, lineNumber]) => {
      const line = lineOf(subject, failedReportOf(reason, lineNumber))
      return line.includes('::error title=Bench invalid::') && line.includes('1 invalid run(s)')
    },
  )
})
