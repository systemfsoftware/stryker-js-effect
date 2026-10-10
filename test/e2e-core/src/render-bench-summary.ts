import * as Arr from 'effect/Array'
import * as Boolean from 'effect/Boolean'
import * as Match from 'effect/Match'

import { BenchReport, type BenchReportRun } from './bench-report.schema.js'
import { BenchRunInvalid } from './bench-run.schema.js'
import {
  type BenchPhase,
  type BenchPhaseRow,
  type BenchProjectSummary,
  type SideCell,
  type SideCounts,
  type Workload,
} from './bench-summary.schema.js'

const round = Math.round

const TABLE_HEADER = '| phase | main (A) | PR (B) | Δ | verdict |'
const TABLE_RULE = '| --- | --- | --- | --- | --- |'

const SIGNAL_NOTE =
  'Signal needs the four-run samples not to overlap and |Δ median| >= 3% of A; under the null a cell is a false signal in at most 2/70 ~ 2.9% of orderings, so a lone signal is a lead to re-run, not proof.'

const seconds = (ms: number): string => (ms / 1000).toFixed(1)

const percent = (share: number): string => `${round(share * 100)}%`

const sideText = (cell: SideCell, phase: BenchPhase): string =>
  Match.value(cell).pipe(
    Match.tag('not-measured', () => 'not measured'),
    Match.tag('measured', (measured): string =>
      Boolean.match(Boolean.and(phase === 'check', measured.notRunEntries > 0), {
        onTrue: () =>
          'not run',
        onFalse: () => `${seconds(measured.medianMs)} s · ${percent(measured.shareMedian)}`,
      })),
    Match.exhaustive,
  )

const deltaText = (row: BenchPhaseRow): string =>
  Match.value(row.verdict).pipe(
    Match.tag('improved', (verdict) => seconds(verdict.deltaMs)),
    Match.tag('regressed', (verdict) => seconds(verdict.deltaMs)),
    Match.tag('no-signal', (verdict) => seconds(verdict.deltaMs)),
    Match.tag('not-measured', () => '—'),
    Match.exhaustive,
  )

const verdictText = (row: BenchPhaseRow): string =>
  Match.value(row.verdict).pipe(
    Match.tag('improved', () => 'improved'),
    Match.tag('regressed', () => 'regressed'),
    Match.tag('no-signal', () => 'no signal'),
    Match.tag('not-measured', () => 'not measured'),
    Match.exhaustive,
  )

const rowText = (row: BenchPhaseRow): string =>
  `| ${row.phase} | ${sideText(row.a, row.phase)} | ${sideText(row.b, row.phase)} | ${deltaText(row)} | ${
    verdictText(row)
  } |`

const rangeText = (range: { readonly min: number; readonly max: number }): string =>
  Boolean.match(range.min === range.max, {
    onTrue: () => `${range.min}`,
    onFalse: () => `${range.min}–${range.max}`,
  })

const sideCountText = (counts: SideCounts): string =>
  `${rangeText(counts.mutants)} mutants, ${rangeText(counts.testsExecuted)} tests executed`

const workloadText = (workload: Workload): string =>
  Match.value(workload).pipe(
    Match.tag('same', () => 'same workload'),
    Match.tag('changed', (changed) => `workload changed: ${changed.entries.join(', ')} — no cell can signal`),
    Match.exhaustive,
  )

const projectBlock = (project: BenchProjectSummary): string =>
  [
    `### ${project.corpus}/${project.entry}`,
    [TABLE_HEADER, TABLE_RULE, ...Arr.map(project.rows, rowText)].join('\n'),
    `Workload: ${workloadText(project.workload)} — Counts: A ${sideCountText(project.counts.a)}; B ${
      sideCountText(project.counts.b)
    }`,
  ].join('\n\n')

const failureLine = (run: BenchRunInvalid): string =>
  `- ${run.key.label} — ${run.reason}${
    Boolean.match(run.lineNumber === null, { onTrue: () => '', onFalse: () => ` (line ${run.lineNumber})` })
  }`

const runText = (run: BenchReportRun): string =>
  `${run.key.label} → ${seconds(run.wallMs)}s${
    Boolean.match(run.exitCode === 0, { onTrue: () => '', onFalse: () => ` (exit ${run.exitCode})` })
  }`

const detailsBlock = (report: BenchReport): string =>
  `<details><summary>setup and run timings (not phase values)</summary>\n\nSetup: ${
    Arr.map(report.setupSteps, (step) => `${step.name} ${seconds(step.ms)}s`).join(', ')
  }; runs: ${Arr.map(report.runs, runText).join('; ')}\n\n</details>`

const headingOf = (report: BenchReport): string => `## Bench comparison: ${report.baseSha} → ${report.headSha}`

export const renderBenchSummary = (report: BenchReport): string =>
  Match.value(report.outcome).pipe(
    Match.tag('failed', (failed) =>
      [headingOf(report), '### Failures', ...Arr.map(failed.invalid, failureLine)].join('\n\n')),
    Match.tag('summarized', (summarized) =>
      [
        headingOf(report),
        ...Arr.map(summarized.projects, projectBlock),
        SIGNAL_NOTE,
        detailsBlock(report),
      ].join('\n\n')),
    Match.exhaustive,
  )
