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
  type BenchReportOutcome,
  type BenchReportRun,
} from './bench-report.schema.js'
import { type BenchRunInvalid } from './bench-run.schema.js'
import {
  type BenchPhaseRow,
  type BenchProjectSummary,
  PhaseVerdict,
  type SampleStatistics,
  type SideCell,
  type SideCounts,
  statisticsOf,
  Workload,
} from './bench-summary.schema.js'

export class RenderBenchReportCommand extends S.TaggedClass<RenderBenchReportCommand>()('RenderBenchReportCommand', {
  report: BenchReport,
}) {
  static readonly [Workflow.InstrumentationBrand] = {} as const
}

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

const itemText = (entry: string, row: BenchPhaseRow, deltaMs: number, deltaShareOfA: number): string =>
  `${entry} ${row.phase} ${signedSeconds(deltaMs)} s (${signedPercent(deltaShareOfA)})`

const verdictItemText = (row: BenchPhaseRow, entry: string): string =>
  Match.value(row.verdict).pipe(
    Match.tag('improved', (verdict) => `improved ${itemText(entry, row, verdict.deltaMs, verdict.deltaShareOfA)}`),
    Match.tag('regressed', (verdict) => `regressed ${itemText(entry, row, verdict.deltaMs, verdict.deltaShareOfA)}`),
    Match.tag('no-signal', () => ''),
    Match.tag('workload-unverified', () => ''),
    Match.tag('not-measured', () => ''),
    Match.exhaustive,
  )

const itemsOf = (
  projects: ReadonlyArray<BenchProjectSummary>,
  isWanted: (row: BenchPhaseRow) => boolean,
): ReadonlyArray<string> =>
  Arr.filter(
    Arr.flatMap(projects, (project) =>
      Arr.map(Arr.filter(project.rows, isWanted), (row) => verdictItemText(row, project.entry))),
    (item) =>
      item.length > 0,
  )

const isRegressed = (row: BenchPhaseRow): boolean => S.is(PhaseVerdict.cases.regressed)(row.verdict)

const isImproved = (row: BenchPhaseRow): boolean => S.is(PhaseVerdict.cases.improved)(row.verdict)

const RULE = '(N=4 per side, non-overlap and >=3% rule)'

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

const summarizedAnnotation = (projects: ReadonlyArray<BenchProjectSummary>): Annotation => {
  const regressed = itemsOf(projects, isRegressed)
  const improved = itemsOf(projects, isImproved)
  const items = [...regressed, ...improved]
  return Boolean.match(regressed.length > 0, {
    onTrue: () => error('Bench regression', sentenceOf(items, projects)),
    onFalse: () =>
      Boolean.match(improved.length > 0, {
        onTrue: () => notice('Bench improvement', sentenceOf(items, projects)),
        onFalse: () => notice('Bench no signal', sentenceOf([], projects)),
      }),
  })
}

const firstInvalidText = (run: BenchRunInvalid): string =>
  `${run.key.label} (${run.code}${
    Option.getOrElse(Option.map(Option.fromNullishOr(run.exitCode), (code) => `, exit ${code}`), () => '')
  })`

const invalidAnnotation = (invalid: ReadonlyArray<BenchRunInvalid>): Annotation =>
  error(
    'Bench invalid',
    `Bench: ${invalid.length} invalid run(s); first ${
      Option.getOrElse(Option.map(Arr.head(invalid), firstInvalidText), () => 'unknown')
    }.`,
  )

const TABLE_HEADER = '| phase | main (A) | PR (B) | Δ | verdict |'
const TABLE_RULE = '| --- | --- | --- | --- | --- |'

const SIGNAL_NOTE =
  'Signal needs the four-run samples not to overlap and |Δ median| >= 3% of A; under the null a cell is a false signal in at most 2/70 ~ 2.9% of orderings, so a lone signal is a lead to re-run, not proof.'

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
  `- ${run.key.label} — ${run.code}: ${run.reason}${optionalText(run.lineNumber, (line) => ` (line ${line})`)}${
    optionalText(run.exitCode, (code) => ` (exit ${code})`)
  }${stderrBlock(run)}`

const runText = (run: BenchReportRun): string =>
  `${run.key.label} → ${seconds(run.wallMs)}s${
    Boolean.match(run.exitCode === 0, { onTrue: () => '', onFalse: () => ` (exit ${run.exitCode})` })
  }`

const detailsBlock = (report: BenchReport): string =>
  `<details><summary>setup and run timings (not phase values)</summary>\n\nSetup: ${
    Arr.map(report.setupSteps, (step) => `${step.name} ${seconds(step.ms)}s`).join(', ')
  }; runs: ${Arr.map(report.runs, runText).join('; ')}\n\n</details>`

const headingOf = (report: BenchReport): string => `## Bench comparison: ${report.baseSha} → ${report.headSha}`

const abortedBlock = (code: BenchAbortCode, reason: string, nextAction: string): string =>
  [`### Aborted: ${code}`, reason, `**Next action:** ${nextAction}`].join('\n\n')

const markdownOf = (report: BenchReport): string =>
  Match.valueTags(report.outcome, {
    aborted: (aborted) =>
      [headingOf(report), abortedBlock(aborted.code, aborted.reason, aborted.nextAction)].join('\n\n'),
    failed: (failed) => [headingOf(report), '### Failures', ...Arr.map(failed.invalid, failureLine)].join('\n\n'),
    summarized: (summarized) =>
      [headingOf(report), ...Arr.map(summarized.projects, projectBlock), SIGNAL_NOTE, detailsBlock(report)].join(
        '\n\n',
      ),
  })

const annotationOf = (outcome: BenchReportOutcome): Annotation =>
  Match.valueTags(outcome, {
    aborted: (aborted) =>
      error('Bench aborted', `Bench aborted (${aborted.code}): ${aborted.reason} Next: ${aborted.nextAction}`),
    failed: (failed) => invalidAnnotation(failed.invalid),
    summarized: (summarized) => summarizedAnnotation(summarized.projects),
  })

const renderedOf = (report: BenchReport): BenchRendered => {
  const annotation = annotationOf(report.outcome)
  const fields = { annotationLine: annotationLineOf(annotation), markdown: markdownOf(report) }
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
