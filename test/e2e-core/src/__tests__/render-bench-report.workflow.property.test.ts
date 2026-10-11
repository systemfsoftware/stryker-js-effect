import { RunEvent } from '@systemfsoftware/stryker-js-cli-contract'
import { describe, it } from '@systemfsoftware/vitest'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import {
  abortedOutcomeOf,
  BenchAbortCode,
  BenchRenderedError,
  BenchReport,
  BenchReportJson,
  BenchReportOutcome,
  type BenchReportRun,
  LegMeasured,
  LegTime,
} from '../bench-report.schema.js'
import {
  BenchRun,
  BenchRunFailureCode,
  BenchRunInvalid,
  BenchRunKey,
  BenchRunMeasured,
  RunIdentity,
} from '../bench-run.schema.js'
import { type BenchSummary, PhaseVerdict } from '../bench-summary.schema.js'
import { WithheldPins } from '../lockfile-pins.schema.js'
import { renderBenchReport, RenderBenchReportCommand } from '../render-bench-report.workflow.js'
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
    workloadDigest: { _tag: 'verified', digest: options.digest ?? 'digest-entry' },
    identity: { _tag: 'read', projectRoot: '/run', runInputsDigest: 'inputs', mutantIdsDigest: 'ids' },
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
  runs.map((run) => ({
    key: run.key,
    wallMs: 1,
    exitCode: 0,
    testsExecuted: 2,
    workloadDigest: { _tag: 'verified', digest: 'digest-entry' },
    identity: { _tag: 'read', projectRoot: '/run', runInputsDigest: 'inputs', mutantIdsDigest: 'ids' },
  }))

const MAIN_REF = 'refs/heads/main'

const summaryOf = (runs: ReadonlyArray<BenchRun>, ref: string = MAIN_REF): BenchSummary =>
  Result.getOrThrow(summarizeBench(SummarizeBenchCommand.make({ sha: 'head', parentSha: 'base', ref, runs })))

const LEG: LegTime = LegMeasured.make({ wallMs: 60_000, targetMs: 600_000 })

const reportOf = (
  summary: BenchSummary,
  runs: ReadonlyArray<BenchRun>,
  baseSha: string,
  headSha: string,
  leg: LegTime = LEG,
  withheldPins: ReadonlyArray<WithheldPins> = [],
  ref: string = MAIN_REF,
): BenchReport =>
  BenchReport.make({
    schemaVersion: '2.0',
    baseSha,
    headSha,
    ref,
    leg,
    outcome: { _tag: 'summarized', projects: summary.projects, regression: summary.regression },
    runs: reportRunsOf(runs),
    setupSteps: [],
    withheldPins: [...withheldPins],
  })

type RenderReport = typeof renderBenchReport

const renderedOf = (subject: RenderReport, report: BenchReport) =>
  Result.getOrThrow(subject(RenderBenchReportCommand.make({ report })))

const annotationOf = (subject: RenderReport, report: BenchReport): string => renderedOf(subject, report).annotationLine

const markdownOf = (subject: RenderReport, report: BenchReport): string => renderedOf(subject, report).markdown

const lineWith = (markdown: string, prefix: string): string =>
  markdown.split('\n').find((line) => line.startsWith(prefix)) ?? ''

const countOf = (text: string, word: string): number => text.split(` ${word} `).length - 1

const rowCountOf = (summary: BenchSummary, tag: 'improved' | 'regressed'): number =>
  summary.projects.reduce(
    (count, project) => count + project.rows.filter((row) => S.is(PhaseVerdict.cases[tag])(row.verdict)).length,
    0,
  )

const medianOf = (values: ReadonlyArray<number>): number => {
  const sorted = [...values].sort((left, right) => left - right)
  const half = sorted.length / 2
  return sorted.length % 2 === 1 ? sorted[(sorted.length - 1) / 2] : (sorted[half - 1] + sorted[half]) / 2
}

const failedReportOf = (invalid: ReadonlyArray<BenchRunInvalid>): BenchReport =>
  BenchReport.make({
    schemaVersion: '2.0',
    baseSha: 'base',
    headSha: 'head',
    ref: MAIN_REF,
    leg: LEG,
    outcome: { _tag: 'failed', invalid },
    runs: [],
    setupSteps: [],
    withheldPins: [],
  })

const invalidOf = (
  code: BenchRunFailureCode,
  reason: string,
  lineNumber: number | null,
  exitCode: number,
  stderrTail: string,
): BenchRunInvalid =>
  BenchRunInvalid.make({
    key: BenchRunKey.make({ corpus: 'repo', entry: 'entry', side: 'B', position: 4 }),
    code,
    reason,
    lineNumber,
    exitCode,
    stderrTail,
  })

const abortedReportOf = (code: BenchAbortCode, reason: string): BenchReport =>
  BenchReport.make({
    schemaVersion: '2.0',
    baseSha: 'base',
    headSha: 'head',
    ref: MAIN_REF,
    leg: LEG,
    outcome: abortedOutcomeOf(code, reason),
    runs: [],
    setupSteps: [],
    withheldPins: [],
  })

const nextActionOf = (outcome: BenchReportOutcome): string =>
  S.is(BenchReportOutcome.cases.aborted)(outcome) ? outcome.nextAction : ''

const withSideIdentities = (report: BenchReport, a: RunIdentity, b: RunIdentity): BenchReport =>
  BenchReport.make({
    schemaVersion: report.schemaVersion,
    baseSha: report.baseSha,
    headSha: report.headSha,
    ref: report.ref,
    leg: report.leg,
    outcome: report.outcome,
    runs: report.runs.map((run) => ({ ...run, identity: run.key.side === 'A' ? a : b })),
    setupSteps: report.setupSteps,
    withheldPins: report.withheldPins,
  })

const identityKeyOf = (identity: RunIdentity): string | null =>
  S.is(RunIdentity.cases.read)(identity) ? `${identity.runInputsDigest}/${identity.mutantIdsDigest}` : null

describe('renderBenchReport', () => {
  it.prop(
    '∀abshr_Summarized_≡HeadingNamesTheRefBothShasAndTheProject',
    {
      of: [
        S.Tuple([S.Int, S.Int, S.Int, S.Int]),
        S.Tuple([S.Int, S.Int, S.Int, S.Int]),
        S.NonEmptyString,
        S.NonEmptyString,
        S.NonEmptyString,
      ],
      subject: renderBenchReport,
    },
    (subject, [rawA, rawB, baseSha, headSha, branch]) => {
      const ref = `refs/heads/${branch}`
      const runs = runsOf(positives(rawA), positives(rawB))
      const markdown = markdownOf(subject, reportOf(summaryOf(runs, ref), runs, baseSha, headSha, LEG, [], ref))
      return markdown.includes(`## Bench comparison on ${ref}: ${baseSha} → ${headSha}`) &&
        markdown.includes('### repo/entry')
    },
  )

  it.prop(
    '∀ab_CheckNotRecorded_≡CheckCellReadsNotMeasured',
    { of: [S.Tuple([S.Int, S.Int, S.Int, S.Int]), S.Tuple([S.Int, S.Int, S.Int, S.Int])], subject: renderBenchReport },
    (subject, [rawA, rawB]) => {
      const runs: ReadonlyArray<BenchRun> = [
        ...fourRuns('A', positives(rawA)),
        ...fourRuns('B', positives(rawB), { check: { _tag: 'measured', ms: 1 } }),
      ]
      const markdown = markdownOf(subject, reportOf(summaryOf(runs), runs, 'base', 'head'))
      return lineWith(markdown, '| check |').includes('not measured')
    },
  )

  it.prop(
    '∀a_EveryCheckNotRun_≡CheckCellReadsNotRun',
    { of: [S.Tuple([S.Int, S.Int, S.Int, S.Int])], subject: renderBenchReport },
    (subject, [rawA]) => {
      const runs: ReadonlyArray<BenchRun> = fourRuns('A', positives(rawA), { check: { _tag: 'not-run' } })
      const markdown = markdownOf(subject, reportOf(summaryOf(runs), runs, 'base', 'head'))
      return lineWith(markdown, '| check |').includes('not run')
    },
  )

  it.prop(
    '∀ab_ReportingNotRecorded_≡ReportingAndMutationReadNotMeasured',
    { of: [S.Tuple([S.Int, S.Int, S.Int, S.Int]), S.Tuple([S.Int, S.Int, S.Int, S.Int])], subject: renderBenchReport },
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
    { of: [S.Tuple([S.Int, S.Int, S.Int, S.Int]), S.Int], subject: renderBenchReport },
    (subject, [rawB, rawExtra]) => {
      const b = positives(rawB)
      const spread = Math.max(...b) - Math.min(...b)
      const gap = Math.max(spread, medianOf(b) * 0.1) + Math.abs(rawExtra) + 10
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
      subject: renderBenchReport,
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
    '∀ab_Annotation_≡ErrorIffARegressionElseNoticeAndOneLine',
    {
      of: [S.Tuple([S.Int, S.Int, S.Int, S.Int]), S.Tuple([S.Int, S.Int, S.Int, S.Int])],
      subject: renderBenchReport,
    },
    (subject, [rawA, rawB]) => {
      const runs = runsOf(positives(rawA), positives(rawB))
      const summary = summaryOf(runs)
      const line = annotationOf(subject, reportOf(summary, runs, 'base', 'head'))
      const level = summary.regression !== null ? '::error title=phase-regressed::' : '::notice title=Bench '
      return line.startsWith(level) && line.includes('\n') === false
    },
  )

  it.prop(
    '∀ab_AnnotationNamesVerdicts_≡CountsMatchTheMarkdown',
    {
      of: [S.Tuple([S.Int, S.Int, S.Int, S.Int]), S.Tuple([S.Int, S.Int, S.Int, S.Int])],
      subject: renderBenchReport,
    },
    (subject, [rawA, rawB]) => {
      const runs = runsOf(positives(rawA), positives(rawB))
      const summary = summaryOf(runs)
      const line = annotationOf(subject, reportOf(summary, runs, 'base', 'head'))
      return countOf(line, 'improved') === rowCountOf(summary, 'improved') &&
        countOf(line, 'regressed') === (summary.regression?.metrics.length ?? 0)
    },
  )

  it.prop(
    '∀ab_SidesSwapped_≡ImprovedAndRegressedSwap',
    {
      of: [S.Tuple([S.Int, S.Int, S.Int, S.Int]), S.Tuple([S.Int, S.Int, S.Int, S.Int])],
      subject: renderBenchReport,
    },
    (subject, [rawA, rawB]) => {
      const forward = summaryOf(runsOf(positives(rawA), positives(rawB)))
      const swapped = summaryOf(runsOf(positives(rawB), positives(rawA)))
      const forwardLine = annotationOf(
        subject,
        reportOf(forward, runsOf(positives(rawA), positives(rawB)), 'base', 'head'),
      )
      const swappedLine = annotationOf(
        subject,
        reportOf(swapped, runsOf(positives(rawB), positives(rawA)), 'base', 'head'),
      )
      return countOf(forwardLine, 'improved') === countOf(swappedLine, 'regressed') &&
        countOf(forwardLine, 'regressed') === countOf(swappedLine, 'improved')
    },
  )

  it.prop(
    '∀ab_ReportRoundTrip_≡Identity',
    {
      of: [S.Tuple([S.Int, S.Int, S.Int, S.Int]), S.Tuple([S.Int, S.Int, S.Int, S.Int])],
      subject: renderBenchReport,
    },
    (subject, [rawA, rawB]) => {
      const runs = runsOf(positives(rawA), positives(rawB))
      const report = reportOf(summaryOf(runs), runs, 'base', 'head')
      const encoded = Result.getOrThrow(S.encodeResult(BenchReportJson)(report))
      const decoded = Result.getOrThrow(S.decodeResult(BenchReportJson)(encoded))
      return JSON.stringify(decoded) === JSON.stringify(report) &&
        annotationOf(subject, decoded) === annotationOf(subject, report)
    },
  )

  it.prop(
    '∀rl_FailedOutcome_≡FailureSectionNamesTheRun',
    { of: [S.NonEmptyString, S.NullOr(S.Int)], subject: renderBenchReport },
    (subject, [reason, lineNumber]) => {
      const report = failedReportOf([invalidOf('stream-undecodable', reason, lineNumber, 0, '')])
      const markdown = markdownOf(subject, report)
      const line = lineNumber === null ? '' : ` (line ${lineNumber})`
      return markdown.includes('### Failures') &&
        markdown.includes(`- repo/entry B@4 — stream-undecodable: ${reason}${line}`)
    },
  )

  it.prop(
    '∀rl_FailedOutcome_≡ErrorInvalidAnnotation',
    { of: [S.NonEmptyString, S.NullOr(S.Int)], subject: renderBenchReport },
    (subject, [reason, lineNumber]) => {
      const line = annotationOf(subject, failedReportOf([invalidOf('stream-undecodable', reason, lineNumber, 0, '')]))
      return line.includes('::error title=Bench invalid::') && line.includes('1 invalid run(s)')
    },
  )

  it.prop(
    '∀rlce_FailedOutcomeMarkdown_≡NamesEachRunsCodeExitAndStderrTail',
    { of: [BenchRunFailureCode, S.NonEmptyString, S.Int, S.String], subject: renderBenchReport },
    (subject, [code, reason, exitCode, stderrTail]) => {
      const report = failedReportOf([invalidOf(code, reason, null, exitCode, stderrTail)])
      const markdown = markdownOf(subject, report)
      const exitText = markdown.includes(`(exit ${exitCode})`)
      const stderrText = stderrTail.length === 0 ? true : markdown.includes(stderrTail)
      return markdown.includes('### Failures') &&
        markdown.includes(`— ${code}:`) &&
        markdown.includes(reason) &&
        exitText &&
        stderrText
    },
  )

  it.prop(
    '∀cr_AbortedOutcomeWithMultiLineReason_≡ErrorAnnotationOnOneLineWithFullReasonInMarkdown',
    { of: [BenchAbortCode, S.NonEmptyString, S.NonEmptyString], subject: renderBenchReport },
    (subject, [code, head, tail]) => {
      const reason = `${head}\n${tail}`
      const report = abortedReportOf(code, reason)
      const rendered = renderedOf(subject, report)
      const next = nextActionOf(report.outcome)
      const plainHead = /^[^%\r\n:,]+$/u.test(head)
      return S.is(BenchRenderedError)(rendered) &&
        rendered.annotationLine.startsWith('::error title=Bench aborted::') &&
        rendered.annotationLine.includes(code) &&
        rendered.annotationLine.includes(`Next: ${next}`) &&
        rendered.annotationLine.includes('\n') === false &&
        rendered.annotationLine.includes('%0A') === false &&
        (plainHead ? rendered.annotationLine.includes(head) : true) &&
        rendered.markdown.includes(`### Aborted: ${code}`) &&
        rendered.markdown.includes(reason) &&
        rendered.markdown.includes(next)
    },
  )

  it.prop(
    '∀ris_AnyIdentityPerSide_≡IdentityLineMatchedIffBothSidesReadOneEqualKey',
    { of: [RunIdentity, RunIdentity, S.Boolean], subject: renderBenchReport },
    (subject, [a, drawnB, sameAsA]) => {
      const b = sameAsA ? a : drawnB
      const runs = runsOf([1, 2, 3, 4], [1, 2, 3, 4])
      const report = withSideIdentities(reportOf(summaryOf(runs), runs, 'base', 'head'), a, b)
      const keyA = identityKeyOf(a)
      const expected = keyA !== null && keyA === identityKeyOf(b) ? 'matched' : 'differed'
      return lineWith(markdownOf(subject, report), '**Run identity:**') ===
        `**Run identity:** the sides' run inputs digests and mutant id sets ${expected}`
    },
  )

  it.prop(
    '∀ag_SeparatedSlowdownOnMain_≡VerdictLineAndSummaryNameRefShasMetricAndTheRevert',
    { of: [S.Tuple([S.Int, S.Int, S.Int, S.Int]), S.Int], subject: renderBenchReport },
    (subject, [rawA, rawExtra]) => {
      const a = positives(rawA)
      const gap = Math.max(Math.max(...a) - Math.min(...a), Math.max(...a) * 0.1) + Math.abs(rawExtra) + 10
      const runs = runsOf(a, a.map((sample) => sample + gap))
      const rendered = renderedOf(subject, reportOf(summaryOf(runs), runs, 'base', 'head'))
      const fields = [
        'on refs/heads/main',
        'head',
        'base',
        `entry mutation-test +${(gap / 1000).toFixed(1)} s`,
        'root opens a revert PR of the culprit or a root-fix P0',
      ]
      return S.is(BenchRenderedError)(rendered) &&
        rendered.annotationLine.startsWith('::error title=phase-regressed::') &&
        rendered.markdown.includes('### Regression: phase-regressed') &&
        fields.every((field) => rendered.annotationLine.includes(field) && rendered.markdown.includes(field))
    },
  )

  it.prop(
    '∀agb_SeparatedSlowdownDispatchedOnABranch_≡VerdictLineAndSummaryNameTheRefAndNoRevert',
    { of: [S.Tuple([S.Int, S.Int, S.Int, S.Int]), S.Int, S.Int], subject: renderBenchReport },
    (subject, [rawA, rawExtra, branch]) => {
      const ref = `refs/heads/stryker/bench-${Math.abs(branch)}`
      const a = positives(rawA)
      const gap = Math.max(Math.max(...a) - Math.min(...a), Math.max(...a) * 0.1) + Math.abs(rawExtra) + 10
      const runs = runsOf(a, a.map((sample) => sample + gap))
      const rendered = renderedOf(subject, reportOf(summaryOf(runs, ref), runs, 'base', 'head', LEG, [], ref))
      const next = `dispatched on ${ref}: speed evidence only, no revert`
      return rendered.annotationLine.includes(`Next: ${next}`) &&
        rendered.markdown.includes(`**Next action:** ${next}`) &&
        rendered.markdown.includes(`## Bench comparison on ${ref}:`) &&
        !rendered.markdown.includes('revert PR')
    },
  )

  it.prop(
    '∀abvw_LegWallTime_≡SameVerdictLineAndLevelWithTheWallTimeInTheSummary',
    {
      of: [S.Tuple([S.Int, S.Int, S.Int, S.Int]), S.Tuple([S.Int, S.Int, S.Int, S.Int]), LegTime, LegTime],
      subject: renderBenchReport,
    },
    (subject, [rawA, rawB, legV, legW]) => {
      const runs = runsOf(positives(rawA), positives(rawB))
      const summary = summaryOf(runs)
      const v = renderedOf(subject, reportOf(summary, runs, 'base', 'head', legV))
      const w = renderedOf(subject, reportOf(summary, runs, 'base', 'head', legW))
      const wallText = S.is(LegMeasured)(legW) ? `${(legW.wallMs / 60_000).toFixed(1)} min` : 'not measured'
      const over = S.is(LegMeasured)(legW) && legW.wallMs > legW.targetMs
      return S.is(BenchRenderedError)(v) === S.is(BenchRenderedError)(w) &&
        v.annotationLine === w.annotationLine &&
        w.markdown.includes(`**Leg wall time:** ${wallText}; target 10.0 min`) &&
        w.markdown.includes('min over (reported, never enforced)') === over
    },
  )

  it.prop(
    '∀r_Report_≡ExitZeroIffSummarizedWithOrWithoutARegression',
    { of: [BenchReport], subject: renderBenchReport },
    (subject, [report]) =>
      renderedOf(subject, report).exitCode === (S.is(BenchReportOutcome.cases.summarized)(report.outcome) ? 0 : 1),
  )

  it.prop(
    '∀abw_WithheldPins_≡OneLineCountingEachSidesNamesWithItsCutoff',
    {
      of: [S.Tuple([S.Int, S.Int, S.Int, S.Int]), S.Tuple([S.Int, S.Int, S.Int, S.Int]), S.Array(WithheldPins)],
      subject: renderBenchReport,
    },
    (subject, [rawA, rawB, withheld]) => {
      const runs = runsOf(positives(rawA), positives(rawB))
      const summary = summaryOf(runs)
      const bare = renderedOf(subject, reportOf(summary, runs, 'base', 'head'))
      const pinned = renderedOf(subject, reportOf(summary, runs, 'base', 'head', LEG, withheld))
      const heading = '**Names the lockfile holds at several versions, left unpinned:**'
      return pinned.annotationLine === bare.annotationLine &&
        pinned.exitCode === bare.exitCode &&
        pinned.markdown.split(heading).length - 1 === (withheld.length === 0 ? 0 : 1) &&
        withheld.every((side) =>
          pinned.markdown.includes(`side ${side.side} ${side.names.length} (installed with --before=${side.cutoff})`)
        )
    },
  )
})
