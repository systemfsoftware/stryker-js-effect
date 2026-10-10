import { RunEvent } from '@systemfsoftware/stryker-js-cli-contract'
import { describe, it } from '@systemfsoftware/vitest'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import { BenchReport, type BenchReportRun } from '../bench-report.schema.js'
import { BenchRun, BenchRunInvalid, BenchRunKey, BenchRunMeasured } from '../bench-run.schema.js'
import { type BenchSummary } from '../bench-summary.schema.js'
import { renderBenchSummary } from '../render-bench-summary.js'
import { summarizeBench, SummarizeBenchCommand } from '../summarize-bench.workflow.js'

const REPORTING_MEASURED: RunEvent.ReportingDuration = { _tag: 'measured', ms: 0 }
const REPORTING_NOT_RECORDED: RunEvent.ReportingDuration = { _tag: 'not-recorded' }

interface RunOptions {
  readonly check?: RunEvent.CheckDuration
  readonly reporting?: RunEvent.ReportingDuration
  readonly digest?: string
}

const runFrom = (
  side: 'A' | 'B',
  position: number,
  mutationTest: number,
  options: RunOptions = {},
): BenchRunMeasured =>
  BenchRunMeasured.make({
    key: BenchRunKey.make({ corpus: 'repo', entry: 'entry', side, position }),
    phaseDurations: {
      prepare: 0,
      instrument: 0,
      'dry-run': 0,
      'mutation-test': mutationTest,
      check: options.check ?? { _tag: 'not-recorded' },
      reporting: options.reporting ?? REPORTING_MEASURED,
    },
    mutants: 10,
    testsExecuted: 2,
    workloadDigest: options.digest ?? 'digest-entry',
    wallMs: mutationTest,
    exitCode: 0,
  })

const fourRuns = (
  side: 'A' | 'B',
  samples: ReadonlyArray<number>,
  options: RunOptions = {},
): ReadonlyArray<BenchRunMeasured> => [
  runFrom(side, 0, samples[0], options),
  runFrom(side, 1, samples[1], options),
  runFrom(side, 2, samples[2], options),
  runFrom(side, 3, samples[3], options),
]

const runsOf = (aSamples: ReadonlyArray<number>, bSamples: ReadonlyArray<number>): ReadonlyArray<BenchRun> => [
  ...fourRuns('A', aSamples),
  ...fourRuns('B', bSamples),
]

const positives = (values: ReadonlyArray<number>): ReadonlyArray<number> => values.map((value) => Math.abs(value) + 1)

const withDriftedDigest = (
  runs: ReadonlyArray<BenchRunMeasured>,
  sample: number,
  digest: string,
): ReadonlyArray<BenchRunMeasured> => runs.map((run, index) => index === 0 ? runFrom('A', 0, sample, { digest }) : run)

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

type RenderSubject = (report: BenchReport) => string

const markdownOf = (subject: RenderSubject, report: BenchReport): string => subject(report)

const lineWith = (markdown: string, prefix: string): string =>
  markdown.split('\n').find((line) => line.startsWith(prefix)) ?? ''

const medianOf = (values: ReadonlyArray<number>): number => {
  const sorted = [...values].sort((left, right) => left - right)
  const half = sorted.length / 2
  return sorted.length % 2 === 1 ? sorted[(sorted.length - 1) / 2] : (sorted[half - 1] + sorted[half]) / 2
}

describe('renderBenchSummary', () => {
  it.prop(
    '∀absh_Summarized_≡HeadingNamesBothShasAndTheProject',
    {
      of: [
        S.Tuple([S.Int, S.Int, S.Int, S.Int]),
        S.Tuple([S.Int, S.Int, S.Int, S.Int]),
        S.NonEmptyString,
        S.NonEmptyString,
      ],
      subject: renderBenchSummary,
    },
    (subject, [rawA, rawB, baseSha, headSha]) => {
      const runs = runsOf(positives(rawA), positives(rawB))
      const markdown = markdownOf(subject, reportOf(summaryOf(runs), runs, baseSha, headSha))
      return markdown.includes(`## Bench comparison: ${baseSha} → ${headSha}`) && markdown.includes('### repo/entry')
    },
  )

  it.prop(
    '∀ab_CheckNotRecorded_≡CheckCellReadsNotMeasured',
    { of: [S.Tuple([S.Int, S.Int, S.Int, S.Int]), S.Tuple([S.Int, S.Int, S.Int, S.Int])], subject: renderBenchSummary },
    (subject, [rawA, rawB]) => {
      const a = positives(rawA)
      const b = positives(rawB)
      const runs: ReadonlyArray<BenchRun> = [
        ...fourRuns('A', a),
        ...fourRuns('B', b, { check: { _tag: 'measured', ms: 1 } }),
      ]
      const markdown = markdownOf(subject, reportOf(summaryOf(runs), runs, 'base', 'head'))
      return lineWith(markdown, '| check |').includes('not measured')
    },
  )

  it.prop(
    '∀a_EveryCheckNotRun_≡CheckCellReadsNotRun',
    { of: [S.Tuple([S.Int, S.Int, S.Int, S.Int])], subject: renderBenchSummary },
    (subject, [rawA]) => {
      const runs: ReadonlyArray<BenchRun> = fourRuns('A', positives(rawA), { check: { _tag: 'not-run' } })
      const markdown = markdownOf(subject, reportOf(summaryOf(runs), runs, 'base', 'head'))
      return lineWith(markdown, '| check |').includes('not run')
    },
  )

  it.prop(
    '∀ab_ReportingNotRecorded_≡ReportingAndMutationReadNotMeasured',
    { of: [S.Tuple([S.Int, S.Int, S.Int, S.Int]), S.Tuple([S.Int, S.Int, S.Int, S.Int])], subject: renderBenchSummary },
    (subject, [rawA, rawB]) => {
      const runs: ReadonlyArray<BenchRun> = [
        ...fourRuns('A', positives(rawA), { reporting: REPORTING_NOT_RECORDED }),
        ...fourRuns('B', positives(rawB)),
      ]
      const markdown = markdownOf(subject, reportOf(summaryOf(runs), runs, 'base', 'head'))
      return lineWith(markdown, '| reporting |').includes('not measured') &&
        lineWith(markdown, '| mutation-test |').includes('not measured')
    },
  )

  it.prop(
    '∀ab_SeparatedGap_≡ImprovedWithTheGapDelta',
    { of: [S.Tuple([S.Int, S.Int, S.Int, S.Int]), S.Int], subject: renderBenchSummary },
    (subject, [rawB, rawExtra]) => {
      const b = positives(rawB)
      const spread = Math.max(...b) - Math.min(...b)
      const gap = Math.max(spread, medianOf(b) * 0.1) + Math.abs(rawExtra) + 1
      const a = b.map((sample) => sample + gap)
      const runs = runsOf(a, b)
      const markdown = markdownOf(subject, reportOf(summaryOf(runs), runs, 'base', 'head'))
      const mutationLine = lineWith(markdown, '| mutation-test |')
      return mutationLine.includes('improved') && mutationLine.includes((-gap / 1000).toFixed(1))
    },
  )

  it.prop(
    '∀abd_OneDifferingDigest_≡WorkloadChangedLine',
    {
      of: [S.Tuple([S.Int, S.Int, S.Int, S.Int]), S.Tuple([S.Int, S.Int, S.Int, S.Int]), S.NonEmptyString],
      subject: renderBenchSummary,
    },
    (subject, [rawA, rawB, digest]) => {
      const a = positives(rawA)
      const b = positives(rawB)
      const runs = withDriftedDigest([...fourRuns('A', a), ...fourRuns('B', b)], a[0], digest)
      const markdown = markdownOf(subject, reportOf(summaryOf(runs), runs, 'base', 'head'))
      return markdown.includes('workload changed:') && markdown.includes('no cell can signal')
    },
  )

  it.prop(
    '∀rl_FailedOutcome_≡FailureSectionNamesTheRun',
    { of: [S.NonEmptyString, S.NullOr(S.Int)], subject: renderBenchSummary },
    (subject, [reason, lineNumber]) => {
      const key = BenchRunKey.make({ corpus: 'repo', entry: 'entry', side: 'B', position: 4 })
      const invalid = BenchRunInvalid.make({ key, reason, lineNumber })
      const report = BenchReport.make({
        schemaVersion: '1.0',
        baseSha: 'base',
        headSha: 'head',
        outcome: { _tag: 'failed', invalid: [invalid] },
        runs: [],
        setupSteps: [],
      })
      const markdown = markdownOf(subject, report)
      const line = lineNumber === null ? '' : ` (line ${lineNumber})`
      return markdown.includes('### Failures') && markdown.includes(`- repo/entry B@4 — ${reason}${line}`)
    },
  )
})
