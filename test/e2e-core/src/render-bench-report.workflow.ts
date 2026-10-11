import { Workflow } from '@systemfsoftware/effect-cell-types'
import * as Arr from 'effect/Array'
import * as Boolean from 'effect/Boolean'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import {
  type BenchAbortCode,
  BenchRendered,
  BenchRenderedError,
  BenchRenderedNotice,
  BenchReport,
  BenchReportOutcome,
  type BenchReportRun,
  type LegTime,
} from './bench-report.schema.js'
import { type BenchRunInvalid } from './bench-run.schema.js'
import {
  type BenchPhaseRow,
  type BenchProjectSummary,
  type PhaseRegression,
  type RegressedMetric,
  type SampleStatistics,
  type SideCell,
  type SideCounts,
  statisticsOf,
  Workload,
} from './bench-summary.schema.js'
import { type WithheldPins } from './lockfile-pins.schema.js'

export class RenderBenchReportCommand extends S.TaggedClass<RenderBenchReportCommand>()('RenderBenchReportCommand', {
  report: BenchReport,
}) {
  static readonly [Workflow.InstrumentationBrand] = {} as const
}

type SummarizedOutcome = typeof BenchReportOutcome.cases.summarized.Type

const round = Math.round
const abs = Math.abs

const seconds = (ms: number): string => (ms / 1000).toFixed(1)

const signedSeconds = (deltaMs: number): string =>
  Boolean.match(deltaMs < 0, {
    onTrue: () => `-${seconds(abs(deltaMs))}`,
    onFalse: () => `+${seconds(abs(deltaMs))}`,
  })

const signedPercent = (share: number): string =>
  Boolean.match(share < 0, {
    onTrue: () => `-${round(abs(share) * 100)}%`,
    onFalse: () => `+${round(abs(share) * 100)}%`,
  })

const escapeMessage = (text: string): string =>
  text.replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A')

const escapeProperty = (text: string): string => escapeMessage(text).replaceAll(':', '%3A').replaceAll(',', '%2C')

interface Annotation {
  readonly level: 'notice' | 'error'
  readonly title: string
  readonly message: string
}

const notice = (title: string, message: string): Annotation => ({ level: 'notice', title, message })

const error = (title: string, message: string): Annotation => ({ level: 'error', title, message })

const annotationLineOf = (annotation: Annotation): string =>
  `::${annotation.level} title=${escapeProperty(annotation.title)}::${escapeMessage(annotation.message)}`

const changeText = (entry: string, phase: string, deltaMs: number, deltaShareOfA: number): string =>
  `${entry} ${phase} ${signedSeconds(deltaMs)} s (${signedPercent(deltaShareOfA)})`

const metricText = (metric: RegressedMetric): string =>
  changeText(metric.entry, metric.phase, metric.deltaMs, metric.deltaShareOfA)

const improvedItemsOf = (projects: ReadonlyArray<BenchProjectSummary>): ReadonlyArray<string> =>
  Arr.flatMap(projects, (project) =>
    Arr.flatMap(project.rows, (row) =>
      Match.valueTags(row.verdict, {
        improved: (verdict): ReadonlyArray<string> => [
          `improved ${changeText(project.entry, row.phase, verdict.deltaMs, verdict.deltaShareOfA)}`,
        ],
        regressed: (): ReadonlyArray<string> => [],
        'no-signal': (): ReadonlyArray<string> => [],
        'workload-unverified': (): ReadonlyArray<string> => [],
        'not-measured': (): ReadonlyArray<string> => [],
      })))

const RULE = '(N=4 per side, non-overlap and >= max(3%, 10 ms) rule; only a leg total decides a regression)'

const unverifiedText = (projects: ReadonlyArray<BenchProjectSummary>): string => {
  const unverified = Arr.filter(projects, (project) => S.is(Workload.cases.unverified)(project.workload))
  return Boolean.match(unverified.length === 0, {
    onTrue: () => '',
    onFalse: () => ` Workload unverified, no signal: ${Arr.map(unverified, (project) => project.entry).join(', ')}.`,
  })
}

const sentenceOf = (items: ReadonlyArray<string>, projects: ReadonlyArray<BenchProjectSummary>): string =>
  Boolean.match(items.length === 0, {
    onTrue: () => `Bench: no project/phase changed past the signal threshold ${RULE}.${unverifiedText(projects)}`,
    onFalse: () => `Bench: ${items.join('; ')} ${RULE}.${unverifiedText(projects)}`,
  })

const regressionAnnotation = (
  regression: PhaseRegression,
  improved: ReadonlyArray<string>,
  projects: ReadonlyArray<BenchProjectSummary>,
): Annotation =>
  error(
    regression.code,
    `Bench ${regression.sha} against parent ${regression.parentSha}: ${
      [...Arr.map(regression.metrics, (metric) => `regressed ${metricText(metric)}`), ...improved].join('; ')
    } ${RULE}.${unverifiedText(projects)} Next: ${regression.nextAction}`,
  )

const summarizedAnnotation = (summarized: SummarizedOutcome): Annotation => {
  const improved = improvedItemsOf(summarized.projects)
  return Option.match(Option.fromNullishOr(summarized.regression), {
    onSome: (regression) => regressionAnnotation(regression, improved, summarized.projects),
    onNone: () =>
      Boolean.match(improved.length > 0, {
        onTrue: () => notice('Bench improvement', sentenceOf(improved, summarized.projects)),
        onFalse: () => notice('Bench no signal', sentenceOf([], summarized.projects)),
      }),
  })
}

const firstInvalidText = (run: BenchRunInvalid): string => `${run.key.label} (${run.code}, exit ${run.exitCode})`

const invalidAnnotation = (invalid: ReadonlyArray<BenchRunInvalid>): Annotation =>
  error(
    'Bench invalid',
    `Bench: ${invalid.length} invalid run(s); first ${
      Option.getOrElse(Option.map(Arr.head(invalid), firstInvalidText), () => 'unknown')
    }.`,
  )

const TABLE_HEADER = '| phase | parent (A) | commit (B) | Δ | verdict |'
const TABLE_RULE = '| --- | --- | --- | --- | --- |'

const SIGNAL_NOTE =
  "Signal needs the four-run samples not to overlap and |Δ median| >= max(3% of A, 10 ms). Only a leg's total decides a regression; a phase verdict attributes it. Under the null a total separates upward in 1/70 of orderings: at most 1/70 ~ 1.4% of unchanged commits raise a false regression on one leg and 4/70 ~ 5.7% on any of the four, before the 3% bar cuts it further."

const percent = (share: number): string => `${round(share * 100)}%`

const cellText = (statistics: SampleStatistics): string =>
  `${seconds(statistics.medianMs)} s · ${percent(statistics.shareMedian)}`

const sideText = (cell: SideCell): string =>
  Match.valueTags(cell, {
    measured: (measured) => cellText(statisticsOf(measured)),
    'not-run': () => 'not run',
    'not-measured': () => 'not measured',
  })

const deltaText = (row: BenchPhaseRow): string =>
  Match.valueTags(row.verdict, {
    improved: (verdict) => seconds(verdict.deltaMs),
    regressed: (verdict) => seconds(verdict.deltaMs),
    'no-signal': (verdict) => seconds(verdict.deltaMs),
    'workload-unverified': () => '—',
    'not-measured': () => '—',
  })

const verdictText = (row: BenchPhaseRow): string =>
  Match.valueTags(row.verdict, {
    improved: () => 'improved',
    regressed: () => 'regressed',
    'no-signal': () => 'no signal',
    'workload-unverified': () => 'workload unverified',
    'not-measured': () => 'not measured',
  })

const rowText = (row: BenchPhaseRow): string =>
  `| ${row.phase} | ${sideText(row.a)} | ${sideText(row.b)} | ${deltaText(row)} | ${verdictText(row)} |`

const rangeText = (range: { readonly min: number; readonly max: number }): string =>
  Boolean.match(range.min === range.max, {
    onTrue: () => `${range.min}`,
    onFalse: () => `${range.min}–${range.max}`,
  })

const sideCountText = (counts: SideCounts): string =>
  `${rangeText(counts.mutants)} mutants, ${rangeText(counts.testsExecuted)} tests executed`

const workloadText = (workload: Workload): string =>
  Match.valueTags(workload, {
    same: () => 'same workload',
    changed: (changed) => `workload changed: ${changed.entries.join(', ')} — no cell can signal`,
    unverified: (unverified) => `workload unverified: ${unverified.reasons.join('; ')} — no cell can signal`,
  })

const projectBlock = (project: BenchProjectSummary): string =>
  [
    `### ${project.corpus}/${project.entry}`,
    [TABLE_HEADER, TABLE_RULE, ...Arr.map(project.rows, rowText)].join('\n'),
    `Workload: ${workloadText(project.workload)} — Counts: A ${sideCountText(project.counts.a)}; B ${
      sideCountText(project.counts.b)
    }`,
  ].join('\n\n')

const optionalText = (value: number | null, render: (value: number) => string): string =>
  Option.match(Option.fromNullishOr(value), { onNone: () => '', onSome: render })

const stderrBlock = (run: BenchRunInvalid): string =>
  Boolean.match(run.stderrTail.length === 0, {
    onTrue: () => '',
    onFalse: () =>
      `\n\n  <details><summary>stderr tail</summary>\n\n  \`\`\`\n${run.stderrTail}\n  \`\`\`\n\n  </details>`,
  })

const failureLine = (run: BenchRunInvalid): string =>
  `- ${run.key.label} — ${run.code}: ${run.reason}${
    optionalText(run.lineNumber, (line) => ` (line ${line})`)
  } (exit ${run.exitCode})${stderrBlock(run)}`

const runText = (run: BenchReportRun): string =>
  `${run.key.label} → ${seconds(run.wallMs)}s${
    Boolean.match(run.exitCode === 0, { onTrue: () => '', onFalse: () => ` (exit ${run.exitCode})` })
  }`

const detailsBlock = (report: BenchReport): string =>
  `<details><summary>setup and run timings (not phase values)</summary>\n\nSetup: ${
    Arr.map(report.setupSteps, (step) => `${step.name} ${seconds(step.ms)}s`).join(', ')
  }; runs: ${Arr.map(report.runs, runText).join('; ')}\n\n</details>`

const headingOf = (report: BenchReport): string => `## Bench comparison: ${report.baseSha} → ${report.headSha}`

const minutes = (ms: number): string => (ms / 60_000).toFixed(1)

const overrunText = (wallMs: number, targetMs: number): string =>
  Boolean.match(wallMs > targetMs, {
    onTrue: () => `, ${minutes(wallMs - targetMs)} min over (reported, never enforced)`,
    onFalse: () => '',
  })

const legText = (leg: LegTime): string =>
  Match.valueTags(leg, {
    LegNotMeasured: (notMeasured) => `**Leg wall time:** not measured; target ${minutes(notMeasured.targetMs)} min`,
    LegMeasured: (measured) =>
      `**Leg wall time:** ${minutes(measured.wallMs)} min; target ${minutes(measured.targetMs)} min${
        overrunText(measured.wallMs, measured.targetMs)
      }`,
  })

const withheldText = (withheld: WithheldPins): string =>
  `side ${withheld.side} ${withheld.names.length} (installed with --before=${withheld.cutoff})`

const withheldLines = (report: BenchReport): ReadonlyArray<string> =>
  Arr.match(report.withheldPins, {
    onEmpty: (): ReadonlyArray<string> => [],
    onNonEmpty: (withheld): ReadonlyArray<string> => [
      `**Names the lockfile holds at several versions, left unpinned:** ${Arr.map(withheld, withheldText).join('; ')}`,
    ],
  })

const headOf = (report: BenchReport): ReadonlyArray<string> => [
  headingOf(report),
  legText(report.leg),
  ...withheldLines(report),
]

const abortedBlock = (code: BenchAbortCode, reason: string, nextAction: string): string =>
  [`### Aborted: ${code}`, reason, `**Next action:** ${nextAction}`].join('\n\n')

const regressionBlock = (regression: PhaseRegression): string =>
  [
    `### Regression: ${regression.code}`,
    `Commit \`${regression.sha}\` against its parent \`${regression.parentSha}\`:`,
    Arr.map(regression.metrics, (metric) => `- ${metric.corpus}/${metricText(metric)}`).join('\n'),
    `**Next action:** ${regression.nextAction}`,
  ].join('\n\n')

const markdownOf = (report: BenchReport): string =>
  Match.valueTags(report.outcome, {
    aborted: (aborted) =>
      [...headOf(report), abortedBlock(aborted.code, aborted.reason, aborted.nextAction)].join('\n\n'),
    failed: (failed) => [...headOf(report), '### Failures', ...Arr.map(failed.invalid, failureLine)].join('\n\n'),
    summarized: (summarized) =>
      [
        ...headOf(report),
        ...Option.toArray(Option.map(Option.fromNullishOr(summarized.regression), regressionBlock)),
        ...Arr.map(summarized.projects, projectBlock),
        SIGNAL_NOTE,
        detailsBlock(report),
      ].join('\n\n'),
  })

const annotationOf = (outcome: BenchReportOutcome): Annotation =>
  Match.valueTags(outcome, {
    aborted: (aborted) =>
      error('Bench aborted', `Bench aborted (${aborted.code}): ${aborted.reason} Next: ${aborted.nextAction}`),
    failed: (failed) => invalidAnnotation(failed.invalid),
    summarized: summarizedAnnotation,
  })

const exitCodeOf = (outcome: BenchReportOutcome): 0 | 1 =>
  Match.valueTags(outcome, {
    summarized: (): 0 | 1 => 0,
    failed: (): 0 | 1 => 1,
    aborted: (): 0 | 1 => 1,
  })

const renderedOf = (report: BenchReport): BenchRendered => {
  const annotation = annotationOf(report.outcome)
  const fields = {
    annotationLine: annotationLineOf(annotation),
    markdown: markdownOf(report),
    exitCode: exitCodeOf(report.outcome),
  }
  return Match.value(annotation.level).pipe(
    Match.when('notice', (): BenchRendered => BenchRenderedNotice.make(fields)),
    Match.when('error', (): BenchRendered => BenchRenderedError.make(fields)),
    Match.exhaustive,
  )
}

const decide = (command: RenderBenchReportCommand): Result.Result<BenchRendered, never> =>
  Result.succeed(renderedOf(command.report))

export const renderBenchReport = Workflow.make({
  command: RenderBenchReportCommand,
  decision: BenchRendered,
  error: S.Never,
  decide,
})
