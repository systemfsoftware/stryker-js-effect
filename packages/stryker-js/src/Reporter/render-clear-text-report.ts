import type { Mutant, Report } from '@systemfsoftware/stryker-js-plugin-interface'
import type { Options } from '@systemfsoftware/stryker-js-plugin-interface'
import type { NonEmptyReadonlyArray } from 'effect/Array'
import * as Arr from 'effect/Array'
import * as Boolean from 'effect/Boolean'
import * as Match from 'effect/Match'
import { max, min } from 'effect/Number'
import * as Option from 'effect/Option'

import { AnsiCode, type AnsiColor } from '../reporting/ansi.schema.js'
import type { FileScore, ReportedMutant } from './summarize-clear-text-report.workflow.js'

export interface ClearTextRenderOptions {
  readonly allowColor: boolean
  readonly allowEmojis: boolean
  readonly logTests: boolean
  readonly maxTestsToLog: number
  readonly reportMutants: boolean
  readonly reportScoreTable: boolean
  readonly skipFull: boolean
  readonly thresholds: Options.MutationScoreThresholds
}

export interface ClearTextSummary {
  readonly scores: FileScore
  readonly totalMutants: number
  readonly testsCompleted: number
  readonly undetected: readonly ReportedMutant[]
  readonly static?: Report.StaticClassSummary | undefined
}

type Tone = 'plain' | 'identifier' | 'emphasis' | 'positive' | 'warning' | 'negative' | 'muted'

interface ReportSpan {
  readonly text: string
  readonly tone: Tone
  readonly leftPad: number
  readonly rightPad: number
  readonly repeat: number
}

type ReportLine = readonly ReportSpan[]

type ReportChunk = readonly ReportLine[]

const EMOJI_BY_STATUS: Record<Mutant.MutantStatus, string> = {
  'Killed': '✅',
  'NoCoverage': '🙈',
  'Ignored': '🤥',
  'Survived': '👽',
  'Timeout': '⏰',
  'Pending': '⌛',
  'RuntimeError': '💥',
  'CompileError': '💥',
}

const FILES_ROOT_NAME = 'All files'

const KNOWN_EMOJI: Record<string, true> = {
  '✅': true,
  '🙈': true,
  '🤥': true,
  '👽': true,
  '⏰': true,
  '⌛': true,
  '💥': true,
}

const spanOf = (text: string, tone: Tone): ReportSpan => ({
  text,
  tone,
  leftPad: 0,
  rightPad: 0,
  repeat: 1,
})

const plain = (text: string): ReportSpan => spanOf(text, 'plain')

const rule = (fill: string, width: number): ReportSpan => ({
  text: fill,
  tone: 'plain',
  leftPad: 0,
  rightPad: 0,
  repeat: width,
})

const emphasized = (allowColor: boolean, tone: Tone): Tone =>
  Boolean.match(allowColor, {
    onTrue: () => tone,
    onFalse: () => 'plain',
  })

const codePointOf = (char: string): number => Option.getOrElse(Option.fromNullishOr(char.codePointAt(0)), () => 0)

const charWidth = (char: string): number =>
  Match.value(char).pipe(
    Match.when((candidate) => KNOWN_EMOJI[candidate] === true, () => 2),
    Match.when((candidate) => codePointOf(candidate) > 0xffff, () => 2),
    Match.orElse(() => 1),
  )

const stringWidth = (text: string): number => Arr.reduce(Array.from(text), 0, (width, char) => width + charWidth(char))

const spanWidth = (span: ReportSpan): number => span.leftPad + span.rightPad + stringWidth(span.text) * span.repeat

const lineWidth = (line: ReportLine): number => Arr.reduce(line, 0, (width, span) => width + spanWidth(span))

const widest = (values: readonly number[]): number =>
  Arr.reduce(values, 0, (present, candidate) => max(present, candidate))

interface CellContent {
  readonly text: string
  readonly indent: number
}

type CellFactory = (row: FileScore, ancestorCount: number) => CellContent

type PadStyle = 'file' | 'first' | 'inner'

interface Pads {
  readonly leftPad: number
  readonly rightPad: number
}

const isFirstColumn = (style: PadStyle): boolean => style !== 'inner'

const paddingWidth = (style: PadStyle): number =>
  Boolean.match(isFirstColumn(style), {
    onTrue: () => 1,
    onFalse: () => 2,
  })

const padsOf = (style: PadStyle, contentWidth: number, netWidth: number): Pads =>
  Match.value(style).pipe(
    Match.when('file', () => ({ leftPad: 0, rightPad: max(netWidth + 1 - contentWidth, 0) })),
    Match.when('first', () => ({ leftPad: max(netWidth - contentWidth, 0), rightPad: 1 })),
    Match.orElse(() => ({ leftPad: max(netWidth - contentWidth, 0) + 1, rightPad: 1 })),
  )

interface Column {
  readonly header: ReportLine
  readonly style: PadStyle
  readonly netWidth: number
}

interface LeafColumn extends Column {
  readonly cell: CellFactory
  readonly tone: (row: FileScore) => Tone
}

interface GroupColumn extends Column {
  readonly leaves: NonEmptyReadonlyArray<LeafColumn>
}

const slotWidthOf = (column: Column): number => column.netWidth + paddingWidth(column.style)

const fromFirst = (index: number, pad: number): number =>
  Boolean.match(index === 0, {
    onTrue: () => pad,
    onFalse: () => 0,
  })

const untilLast = (index: number, lastIndex: number, pad: number): number =>
  Boolean.match(index === lastIndex, {
    onTrue: () => pad,
    onFalse: () => 0,
  })

const placedLine = (line: ReportLine, style: PadStyle, netWidth: number): ReportLine => {
  const pads = padsOf(style, lineWidth(line), netWidth)
  const lastIndex = line.length - 1
  const placed = (span: ReportSpan, index: number): ReportSpan => ({
    ...span,
    leftPad: fromFirst(index, pads.leftPad),
    rightPad: untilLast(index, lastIndex, pads.rightPad),
  })
  return Arr.map(line, placed)
}

const placedCell = (content: CellContent, style: PadStyle, netWidth: number, tone: Tone): ReportSpan => {
  const pads = padsOf(style, content.indent + stringWidth(content.text), netWidth)
  return {
    text: content.text,
    tone,
    leftPad: pads.leftPad + content.indent,
    rightPad: pads.rightPad,
    repeat: 1,
  }
}

const PIPE = plain('|')

const rowOfLines = (cells: readonly ReportLine[]): ReportLine => cells.flatMap((cell) => [...cell, PIPE])

const EMPTY_LINE: ReportLine = []

const chunkOf = (line: ReportLine): ReportChunk => [line]

const statusLabel = (status: Mutant.MutantStatus, allowEmojis: boolean): ReportLine =>
  Boolean.match(allowEmojis, {
    onTrue: () => [plain(EMOJI_BY_STATUS[status]), plain(' '), plain(status)],
    onFalse: () => [plain(status)],
  })

const mutantHeader = (status: Mutant.MutantStatus, mutatorName: string, allowEmojis: boolean): ReportLine => [
  plain('['),
  ...statusLabel(status, allowEmojis),
  plain('] '),
  plain(mutatorName),
]

const sourceLocation = (fileName: string, position: Mutant.Position, allowColor: boolean): ReportLine => [
  spanOf(fileName, emphasized(allowColor, 'identifier')),
  plain(':'),
  spanOf(String(position.line), emphasized(allowColor, 'emphasis')),
  plain(':'),
  spanOf(String(position.column), emphasized(allowColor, 'emphasis')),
]

const indexedLine = (lines: readonly string[], index: number): string =>
  Option.getOrElse(Option.fromNullishOr(lines[index]), () => '')

const sourceLine = (source: string, position: Mutant.Position): string =>
  indexedLine(source.split('\n'), position.line - 1)

const tailFromColumn = (raw: string, column: number): readonly string[] =>
  Boolean.match(raw.length === 0, {
    onTrue: () => [],
    onFalse: () => [raw.slice(column - 1)],
  })

const originalLines = (source: string, position: Mutant.Position, allowColor: boolean): readonly ReportLine[] => {
  const tone = emphasized(allowColor, 'negative')
  return tailFromColumn(sourceLine(source, position), position.column).map((line) => [
    spanOf('-   ', tone),
    spanOf(line, tone),
  ])
}

const replacementLines = (replacement: string | undefined, allowColor: boolean): readonly ReportLine[] => {
  const tone = emphasized(allowColor, 'positive')
  return Option.match(Option.fromUndefinedOr(replacement), {
    onNone: () => [],
    onSome: (text) =>
      Arr.filter(text.split('\n'), (line) => line !== '').map((line) => [spanOf('+   ', tone), spanOf(line, tone)]),
  })
}

const plural = (items: number): string =>
  Boolean.match(items > 1, {
    onTrue: () => 's',
    onFalse: () => '',
  })

const overflowNotice = (hidden: number): readonly ReportLine[] =>
  Boolean.match(hidden <= 0, {
    onTrue: () => [],
    onFalse: () => [[plain('  and '), plain(String(hidden)), plain(' more test'), plain(plural(hidden)), plain('!')]],
  })

const formatCoveredTests = (tests: readonly string[], render: ClearTextRenderOptions): readonly ReportLine[] => {
  const logged = min(render.maxTestsToLog, tests.length)
  return Boolean.match(logged <= 0, {
    onTrue: () => [],
    onFalse: () => [
      [plain('Tests ran:')],
      ...tests.slice(0, logged).map((test) => [plain('    '), plain(test)]),
      ...overflowNotice(tests.length - render.maxTestsToLog),
      EMPTY_LINE,
    ],
  })
}

const loggedTests = (mutant: Report.MutantResult, render: ClearTextRenderOptions): Option.Option<readonly string[]> =>
  Boolean.match(render.logTests, {
    onTrue: () => Option.fromUndefinedOr(mutant.coveredBy),
    onFalse: () => Option.none(),
  })

const coveredTestsTail = (mutant: Report.MutantResult, render: ClearTextRenderOptions): readonly ReportLine[] =>
  Option.match(loggedTests(mutant, render), {
    onNone: () => [],
    onSome: (tests) => formatCoveredTests(tests, render),
  })

const survivorTail = (mutant: Report.MutantResult, render: ClearTextRenderOptions): readonly ReportLine[] =>
  Boolean.match(mutant.static === true, {
    onTrue: () => [[plain('Ran all tests for this mutant.')]],
    onFalse: () => coveredTestsTail(mutant, render),
  })

const killerTail = (mutant: Report.MutantResult): readonly ReportLine[] =>
  Option.match(Option.flatMap(Option.fromUndefinedOr(mutant.killedBy), Arr.head), {
    onNone: () => [],
    onSome: (killer) => [[plain('Killed by: '), plain(killer)]],
  })

const statusReasonTail = (mutant: Report.MutantResult): readonly ReportLine[] =>
  Option.match(Option.fromUndefinedOr(mutant.statusReason), {
    onNone: () => [],
    onSome: (statusReason) => [[plain('Error message: '), plain(statusReason)]],
  })

const statusTail = (mutant: Report.MutantResult, render: ClearTextRenderOptions): readonly ReportLine[] =>
  Match.value(mutant.status).pipe(
    Match.when('Survived', () => survivorTail(mutant, render)),
    Match.when('Killed', () => killerTail(mutant)),
    Match.whenOr('RuntimeError', 'CompileError', () => statusReasonTail(mutant)),
    Match.orElse((): readonly ReportLine[] => []),
  )

const mutantBlock = (entry: ReportedMutant, render: ClearTextRenderOptions): readonly ReportChunk[] =>
  [
    mutantHeader(entry.mutant.status, entry.mutant.mutatorName, render.allowEmojis),
    sourceLocation(entry.fileName, entry.mutant.location.start, render.allowColor),
    ...originalLines(entry.source, entry.mutant.location.start, render.allowColor),
    ...replacementLines(entry.mutant.replacement, render.allowColor),
    ...statusTail(entry.mutant, render),
    EMPTY_LINE,
  ].map(chunkOf)

const mutantBlocks = (mutants: readonly ReportedMutant[], render: ClearTextRenderOptions): readonly ReportChunk[] =>
  mutants.flatMap((entry) => mutantBlock(entry, render))

const testsPerMutant = (totalMutants: number, testsCompleted: number): string =>
  Boolean.match(totalMutants === 0, {
    onTrue: () => '0.00',
    onFalse: () => (testsCompleted / totalMutants).toFixed(2),
  })

const testsPerMutantLine = (summary: ClearTextSummary): ReportLine => [
  plain('Ran '),
  plain(testsPerMutant(summary.totalMutants, summary.testsCompleted)),
  plain(' tests per mutant on average.'),
]

const mutantReportChunks = (summary: ClearTextSummary, render: ClearTextRenderOptions): readonly ReportChunk[] =>
  Boolean.match(render.reportMutants, {
    onTrue: () => [
      chunkOf(EMPTY_LINE),
      ...mutantBlocks(summary.undetected, render),
      chunkOf(testsPerMutantLine(summary)),
    ],
    onFalse: () => [],
  })

const hasFullScore = (row: FileScore): boolean =>
  Match.valueTags(row.mutationScore, {
    Scored: ({ percentage }) => percentage === 100,
    Unscored: () => false,
  })

const partialScoresVisible = (scores: FileScore, render: ClearTextRenderOptions): boolean =>
  Boolean.match(render.skipFull, {
    onTrue: () => scores.childResults.some((child) => !hasFullScore(child)),
    onFalse: () => true,
  })

const drawsScoreTable = (scores: FileScore, render: ClearTextRenderOptions): boolean =>
  Boolean.match(render.reportScoreTable, {
    onTrue: () => partialScoresVisible(scores, render),
    onFalse: () => false,
  })

type ScoreType = 'total' | 'covered'

const mutationScoreOf = (scoreType: ScoreType, row: FileScore): Report.MutationScore =>
  Match.value(scoreType).pipe(
    Match.when('total', () => row.mutationScore),
    Match.when('covered', () => row.mutationScoreBasedOnCoveredCode),
    Match.exhaustive,
  )

const scoreText = (scoreType: ScoreType, row: FileScore): string =>
  Match.valueTags(mutationScoreOf(scoreType, row), {
    Scored: ({ percentage }) => percentage.toFixed(2),
    Unscored: () => 'n/a',
  })

const thresholdTone = (thresholds: Options.MutationScoreThresholds, score: Report.MutationScore): Tone =>
  Match.valueTags(score, {
    Scored: ({ percentage }) =>
      Match.value(percentage).pipe(
        Match.when((value) => value >= thresholds.high, (): Tone => 'positive'),
        Match.when((value) => value >= thresholds.low, (): Tone => 'warning'),
        Match.orElse((): Tone => 'negative'),
      ),
    Unscored: (): Tone => 'muted',
  })

const scoreTone = (
  thresholds: Options.MutationScoreThresholds,
  scoreType: ScoreType,
  allowColor: boolean,
): (row: FileScore) => Tone =>
  Boolean.match(allowColor, {
    onTrue: () => (row) => thresholdTone(thresholds, mutationScoreOf(scoreType, row)),
    onFalse: () => (): Tone => 'plain',
  })

const contentWidth = (content: CellContent): number => content.indent + content.text.length

const determineContentWidth = (row: FileScore, cell: CellFactory, ancestorCount: number): number =>
  widest([
    contentWidth(cell(row, ancestorCount)),
    ...row.childResults.map((child) => determineContentWidth(child, cell, ancestorCount + 1)),
  ])

const leafColumn = (
  header: ReportLine,
  style: PadStyle,
  cell: CellFactory,
  tone: (row: FileScore) => Tone,
  rows: FileScore,
): LeafColumn => ({
  header,
  style,
  cell,
  tone,
  netWidth: widest([determineContentWidth(rows, cell, 0), lineWidth(header)]),
})

const fileCell = (row: FileScore, ancestorCount: number): CellContent => ({
  text: Boolean.match(ancestorCount === 0, {
    onTrue: () => FILES_ROOT_NAME,
    onFalse: () => row.name,
  }),
  indent: ancestorCount,
})

const fileColumn = (rows: FileScore): LeafColumn => leafColumn([plain('File')], 'file', fileCell, () => 'plain', rows)

const scoreColumn = (
  rows: FileScore,
  thresholds: Options.MutationScoreThresholds,
  scoreType: ScoreType,
  allowColor: boolean,
): LeafColumn =>
  leafColumn(
    [plain(scoreType)],
    'inner',
    (row) => ({ text: scoreText(scoreType, row), indent: 0 }),
    scoreTone(thresholds, scoreType, allowColor),
    rows,
  )

interface StatusColumnSpec {
  readonly emoji: string
  readonly label: string
  readonly count: (row: FileScore) => number
}

const STATUS_COLUMNS: readonly StatusColumnSpec[] = [
  { emoji: '✅', label: 'killed', count: (row) => row.killed },
  { emoji: '⌛️', label: 'timeout', count: (row) => row.timeout },
  { emoji: '👽', label: 'survived', count: (row) => row.survived },
  { emoji: '🙈', label: 'no cov', count: (row) => row.noCoverage },
  { emoji: '💥', label: 'errors', count: (row) => row.invalid },
]

const statusHeader = (allowEmojis: boolean, emoji: string, label: string): ReportLine =>
  Boolean.match(allowEmojis, {
    onTrue: () => [plain(emoji), plain(' '), plain(label)],
    onFalse: () => [plain('# '), plain(label)],
  })

const statusColumn = (spec: StatusColumnSpec, allowEmojis: boolean, rows: FileScore): LeafColumn =>
  leafColumn(
    statusHeader(allowEmojis, spec.emoji, spec.label),
    'inner',
    (row) => ({ text: spec.count(row).toString(), indent: 0 }),
    () => 'plain',
    rows,
  )

const columnsWidthOf = (leaves: NonEmptyReadonlyArray<LeafColumn>): number => {
  const [first, ...rest] = leaves
  return Arr.reduce(rest, slotWidthOf(first), (total, leaf) => total + slotWidthOf(leaf)) -
    paddingWidth(first.style)
}

const widenFirst = (
  leaves: NonEmptyReadonlyArray<LeafColumn>,
  columnsWidth: number,
  netWidth: number,
): NonEmptyReadonlyArray<LeafColumn> => {
  const [first, ...rest] = leaves
  return Boolean.match(netWidth > columnsWidth + 1, {
    onTrue: () => [{ ...first, netWidth: first.netWidth + (netWidth - columnsWidth - 1) }, ...rest],
    onFalse: () => leaves,
  })
}

const groupColumn = (header: ReportLine, style: PadStyle, leaves: NonEmptyReadonlyArray<LeafColumn>): GroupColumn => {
  const columnsWidth = columnsWidthOf(leaves)
  const netWidth = widest([lineWidth(header), columnsWidth])
  return { header, style, netWidth, leaves: widenFirst(leaves, columnsWidth, netWidth) }
}

const createColumns = (scores: FileScore, render: ClearTextRenderOptions): readonly GroupColumn[] => [
  groupColumn([plain('')], 'first', [fileColumn(scores)]),
  groupColumn([plain('% Mutation score')], 'inner', [
    scoreColumn(scores, render.thresholds, 'total', render.allowColor),
    scoreColumn(scores, render.thresholds, 'covered', render.allowColor),
  ]),
  ...STATUS_COLUMNS.map((spec) => groupColumn([plain('')], 'inner', [statusColumn(spec, render.allowEmojis, scores)])),
]

const leafRules = (columns: readonly GroupColumn[]): readonly ReportLine[] =>
  columns.flatMap((column) => column.leaves.map((leaf) => [rule('-', slotWidthOf(leaf))]))

const leafHeaders = (columns: readonly GroupColumn[]): readonly ReportLine[] =>
  columns.flatMap((column) => column.leaves.map((leaf) => placedLine(leaf.header, leaf.style, leaf.netWidth)))

const fullRowVisible = (render: ClearTextRenderOptions, row: FileScore): boolean =>
  Boolean.match(render.skipFull, {
    onTrue: () => !hasFullScore(row),
    onFalse: () => true,
  })

const bodyRow = (columns: readonly GroupColumn[], row: FileScore, ancestorCount: number): ReportLine =>
  rowOfLines(
    columns.flatMap((column) =>
      column.leaves.map((
        leaf,
      ) => [placedCell(leaf.cell(row, ancestorCount), leaf.style, leaf.netWidth, leaf.tone(row))])
    ),
  )

const ownRow = (
  columns: readonly GroupColumn[],
  render: ClearTextRenderOptions,
  row: FileScore,
  ancestorCount: number,
) =>
  Boolean.match(fullRowVisible(render, row), {
    onTrue: () => [bodyRow(columns, row, ancestorCount)],
    onFalse: () => [],
  })

const bodyRows = (
  columns: readonly GroupColumn[],
  render: ClearTextRenderOptions,
  current: FileScore,
  ancestorCount: number,
): readonly ReportLine[] => [
  ...ownRow(columns, render, current, ancestorCount),
  ...current.childResults.flatMap((child) => bodyRows(columns, render, child, ancestorCount + 1)),
]

const scoreTable = (scores: FileScore, render: ClearTextRenderOptions): ReportChunk => {
  const columns = createColumns(scores, render)
  return [
    rowOfLines(columns.map((column) => [rule('-', slotWidthOf(column))])),
    rowOfLines(columns.map((column) => placedLine(column.header, column.style, column.netWidth))),
    rowOfLines(leafHeaders(columns)),
    rowOfLines(leafRules(columns)),
    ...bodyRows(columns, render, scores, 0),
    rowOfLines(leafRules(columns)),
  ]
}

const scoreTableChunks = (scores: FileScore, render: ClearTextRenderOptions): readonly ReportChunk[] =>
  Boolean.match(drawsScoreTable(scores, render), {
    onTrue: () => [scoreTable(scores, render)],
    onFalse: () => [],
  })

const STATIC_SUMMARY_PREFIX = 'Static mutants: '

const staticSummaryChunks = (summary: ClearTextSummary): readonly ReportChunk[] =>
  Option.match(Option.fromUndefinedOr(summary.static), {
    onNone: () => [],
    onSome: (present) => [
      chunkOf([
        plain(`${STATIC_SUMMARY_PREFIX}${present.count} of ${summary.totalMutants} (${present.costMs.toFixed(0)}ms)`),
      ]),
    ],
  })

const tint = (color: AnsiColor, text: string): string =>
  `${AnsiCode.fields[color].literal}${text}${AnsiCode.fields.reset.literal}`

const TINT_BY_TONE: Record<Tone, (text: string) => string> = {
  plain: (text) => text,
  identifier: (text) => tint('cyan', text),
  emphasis: (text) => tint('yellow', text),
  positive: (text) => tint('green', text),
  warning: (text) => tint('yellow', text),
  negative: (text) => tint('red', text),
  muted: (text) => tint('grey', text),
}

const bytesOf = (span: ReportSpan): string =>
  `${' '.repeat(span.leftPad)}${span.text.repeat(span.repeat)}${' '.repeat(span.rightPad)}`

interface ToneRun {
  readonly tone: Tone
  readonly bytes: string
}

const appendSpan = (runs: ReadonlyArray<ToneRun>, span: ReportSpan): ReadonlyArray<ToneRun> =>
  Option.match(Option.filter(Arr.last(runs), (last) => last.tone === span.tone), {
    onNone: () => [...runs, { tone: span.tone, bytes: bytesOf(span) }],
    onSome: (last) => [...runs.slice(0, -1), { tone: last.tone, bytes: `${last.bytes}${bytesOf(span)}` }],
  })

const renderLine = (line: ReportLine): string =>
  Arr.reduce(line, Arr.empty<ToneRun>(), appendSpan).map((run) => TINT_BY_TONE[run.tone](run.bytes)).join('')

const renderChunk = (chunk: ReportChunk): string => `${chunk.map(renderLine).join('\n')}\n`

const clearTextChunks = (summary: ClearTextSummary, render: ClearTextRenderOptions): readonly ReportChunk[] => [
  chunkOf(EMPTY_LINE),
  ...mutantReportChunks(summary, render),
  ...staticSummaryChunks(summary),
  ...scoreTableChunks(summary.scores, render),
]

const settledChunks = (settled: readonly ReportedMutant[], render: ClearTextRenderOptions): readonly ReportChunk[] =>
  Boolean.match(render.reportMutants, {
    onTrue: () => mutantBlocks(settled, render),
    onFalse: () => [],
  })

export const renderClearTextReport = (
  report: { readonly summary: ClearTextSummary; readonly render: ClearTextRenderOptions },
): readonly string[] => clearTextChunks(report.summary, report.render).map(renderChunk)

export const renderSettledMutants = (
  report: { readonly settled: readonly ReportedMutant[]; readonly render: ClearTextRenderOptions },
): readonly string[] => settledChunks(report.settled, report.render).map(renderChunk)

if (import.meta.vitest !== void 0) {
  const { it } = await import('@systemfsoftware/vitest')
  const Arbitrary = await import('effect/Arbitrary')
  const { Options: OptionSchemas } = await import('@systemfsoftware/stryker-js-plugin-interface')
  const { ClearTextReportDetailed, ClearTextReportSummarized } = await import(
    './summarize-clear-text-report.workflow.js'
  )

  const renderOf = (options: Options.StrykerOptions): ClearTextRenderOptions => ({
    ...options.clearTextReporter,
    thresholds: options.thresholds,
  })
  const summaryArb = Arbitrary.schema(ClearTextReportSummarized)
  const renderArb = Arbitrary.schema(OptionSchemas.StrykerOptionsSchema).pipe(Arbitrary.map(renderOf))
  const settledArb = Arbitrary.schema(ClearTextReportDetailed).pipe(Arbitrary.map((detailed) => detailed.settled))

  const fileRowsOf = (scores: FileScore): number =>
    1 + Arr.reduce(scores.childResults, 0, (rows, child) => rows + fileRowsOf(child))

  const TABLE_CHROME_ROWS = 5

  const staticSummaryTextsOf = (chunks: readonly ReportChunk[]): readonly string[] =>
    chunks
      .flatMap((chunk) => chunk.flatMap((line) => line.map((span) => span.text)))
      .filter((text) => text.startsWith(STATIC_SUMMARY_PREFIX))

  const namesSuppliedCount = (texts: readonly string[], supplied: Report.StaticClassSummary): boolean =>
    texts.length === 1 && texts.every((text) => text.includes(String(supplied.count)))

  it.prop(
    '∀srs_ColorOff_≡PlainSpans',
    { of: [summaryArb, renderArb, settledArb], subject: clearTextChunks },
    (subject, [summary, render, settled]) => {
      const colorless = { ...render, allowColor: false }
      return [...subject(summary, colorless), ...settledChunks(settled, colorless)]
        .flat(2)
        .every((span) => span.tone === 'plain')
    },
  )

  it.prop(
    '∀sr_StaticSummary_≡PresentExactlyWhenSupplied',
    {
      of: [Arbitrary.all([summaryArb, renderArb])],
      subject: clearTextChunks,
      cover: {
        supplied: [([summary]) => summary.static !== undefined, 0.05],
        absent: [([summary]) => summary.static === undefined, 0.05],
      },
    },
    (subject, [[summary, render]]) => {
      const texts = staticSummaryTextsOf(subject(summary, render))
      return Option.match(Option.fromUndefinedOr(summary.static), {
        onNone: () => texts.length === 0,
        onSome: (supplied) => namesSuppliedCount(texts, supplied),
      })
    },
  )

  it.prop(
    '∀sr_Scores_≡OneTableRowPerFile',
    { of: [summaryArb, renderArb], subject: clearTextChunks },
    (subject, [summary, render]) =>
      Option.match(Arr.last(subject(summary, { ...render, reportScoreTable: true, skipFull: false })), {
        onNone: () => false,
        onSome: (table) => table.length - TABLE_CHROME_ROWS === fileRowsOf(summary.scores),
      }),
  )
}
