import * as Arr from 'effect/Array'
import * as Boolean from 'effect/Boolean'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as S from 'effect/Schema'

import { BenchReport } from './bench-report.schema.js'
import { BenchRunInvalid, BenchRunKey } from './bench-run.schema.js'
import { type BenchPhaseRow, type BenchProjectSummary, PhaseVerdict } from './bench-summary.schema.js'

const round = Math.round
const abs = Math.abs

const seconds = (ms: number): string => (ms / 1000).toFixed(1)

const keyLabel = (key: BenchRunKey): string => `${key.corpus}/${key.entry} ${key.side}@${key.position}`

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

const commandLine = (level: string, title: string, message: string): string =>
  `::${level} title=${escapeProperty(title)}::${escapeMessage(message)}`

const itemText = (entry: string, row: BenchPhaseRow, deltaMs: number, deltaShareOfA: number): string =>
  `${entry} ${row.phase} ${signedSeconds(deltaMs)} s (${signedPercent(deltaShareOfA)})`

const verdictItemText = (row: BenchPhaseRow, entry: string): string =>
  Match.value(row.verdict).pipe(
    Match.tag('improved', (verdict) => `improved ${itemText(entry, row, verdict.deltaMs, verdict.deltaShareOfA)}`),
    Match.tag('regressed', (verdict) => `regressed ${itemText(entry, row, verdict.deltaMs, verdict.deltaShareOfA)}`),
    Match.tag('no-signal', () => ''),
    Match.tag('not-measured', () => ''),
    Match.exhaustive,
  )

const itemsOf = (
  projects: ReadonlyArray<BenchProjectSummary>,
  isWanted: (row: BenchPhaseRow) => boolean,
): ReadonlyArray<string> =>
  Arr.filter(
    Arr.flatMap(projects, (project) =>
      Arr.map(project.rows, (row) =>
        Boolean.match(isWanted(row), {
          onTrue: () => verdictItemText(row, project.entry),
          onFalse: () => '',
        }))),
    (item) => item.length > 0,
  )

const isRegressed = (row: BenchPhaseRow): boolean => S.is(PhaseVerdict.cases.regressed)(row.verdict)

const isImproved = (row: BenchPhaseRow): boolean => S.is(PhaseVerdict.cases.improved)(row.verdict)

const RULE = '(N=4 per side, non-overlap and >=3% rule)'

const sentenceOf = (items: ReadonlyArray<string>): string =>
  Boolean.match(items.length === 0, {
    onTrue: () => `Bench: no project/phase changed past the signal threshold ${RULE}.`,
    onFalse: () => `Bench: ${items.join('; ')} ${RULE}.`,
  })

const summarizedLine = (projects: ReadonlyArray<BenchProjectSummary>): string => {
  const regressed = itemsOf(projects, isRegressed)
  const improved = itemsOf(projects, isImproved)
  const items = [...regressed, ...improved]
  return Boolean.match(regressed.length > 0, {
    onTrue: () => commandLine('error', 'Bench regression', sentenceOf(items)),
    onFalse: () =>
      Boolean.match(improved.length > 0, {
        onTrue: () => commandLine('notice', 'Bench improvement', sentenceOf(items)),
        onFalse: () => commandLine('notice', 'Bench no signal', sentenceOf([])),
      }),
  })
}

const invalidLine = (invalid: ReadonlyArray<BenchRunInvalid>): string =>
  commandLine(
    'error',
    'Bench invalid',
    `Bench: ${invalid.length} invalid run(s); first ${
      Option.getOrElse(Option.map(Arr.head(invalid), (run) => keyLabel(run.key)), () => 'unknown')
    }.`,
  )

export const renderBenchAnnotation = (report: BenchReport): string =>
  Match.value(report.outcome).pipe(
    Match.tag('failed', (failed) => invalidLine(failed.invalid)),
    Match.tag('summarized', (summarized) => summarizedLine(summarized.projects)),
    Match.exhaustive,
  )
