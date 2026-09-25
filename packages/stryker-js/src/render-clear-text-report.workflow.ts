import { Workflow } from '@systemfsoftware/effect-cell-types'
import type { Mutant } from '@systemfsoftware/stryker-js-instrumenter'
import { Options, Report } from '@systemfsoftware/stryker-js-plugin-interface'
import type { NonEmptyReadonlyArray } from 'effect/Array'
import * as Arr from 'effect/Array'
import * as Boolean from 'effect/Boolean'
import * as Match from 'effect/Match'
import { max, min } from 'effect/Number'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

const ClearTextReportTypeId: unique symbol = Symbol.for('@systemfsoftware/stryker-js/ClearTextReport')
type ClearTextReportTypeId = typeof ClearTextReportTypeId

export const ToneSchema = S.Literals([
  'plain',
  'identifier',
  'emphasis',
  'positive',
  'warning',
  'negative',
  'muted',
])
export type Tone = typeof ToneSchema.Type

const ReportSpanSchema = S.TaggedStruct('ReportSpan', {
  text: S.String,
  tone: ToneSchema,
  leftPad: S.Finite,
  rightPad: S.Finite,
  repeat: S.Finite,
})
export type ReportSpan = typeof ReportSpanSchema.Type

const ReportLineSchema = S.Array(ReportSpanSchema)
export type ReportLine = typeof ReportLineSchema.Type

const ReportChunkSchema = S.Array(ReportLineSchema)
export type ReportChunk = typeof ReportChunkSchema.Type

export const ClearTextRenderOptions = S.Struct({
  allowColor: S.Boolean,
  allowEmojis: S.Boolean,
  logTests: S.Boolean,
  maxTestsToLog: S.Finite,
  reportMutants: S.Boolean,
  reportScoreTable: S.Boolean,
  skipFull: S.Boolean,
  debug: S.Boolean,
  thresholds: Options.MutationScoreThresholdsSchema,
})
export type ClearTextRenderOptions = typeof ClearTextRenderOptions.Type

export class ClearTextReportCommand extends S.TaggedClass<ClearTextReportCommand>()('ClearTextReportCommand', {
  reported: S.optional(Report.MutationTestResultSchema),
  computed: S.optional(Report.MetricsResultSchema),
  render: ClearTextRenderOptions,
  rendered: S.Boolean,
}) {
  static readonly [Workflow.InstrumentationBrand] = { rendered: 'stryker.report.render' } as const
}

export class ClearTextReportRendered extends S.TaggedClass<ClearTextReportRendered>()('ClearTextReportRendered', {
  stdout: S.Array(ReportChunkSchema),
  diagnostics: S.Array(ReportChunkSchema),
  stderr: S.Array(ReportChunkSchema),
}) {
  readonly [ClearTextReportTypeId] = ClearTextReportTypeId
}

export class ClearTextReportSuppressed
  extends S.TaggedClass<ClearTextReportSuppressed>()('ClearTextReportSuppressed', {})
{
  readonly [ClearTextReportTypeId] = ClearTextReportTypeId
}

export const ClearTextReportDecision = S.Union([ClearTextReportRendered, ClearTextReportSuppressed])
export type ClearTextReportDecision = typeof ClearTextReportDecision.Type

type ReportMutant = Report.MutantResult & { fileName: string }

interface ReportMutantEntry {
  readonly fileName: string
  readonly mutant: ReportMutant
  readonly source: string | undefined
}

type ReportChannel = 'stdout' | 'diagnostic' | 'none'

const CHANNEL_BY_STATUS: Record<Mutant.MutantStatus, ReportChannel> = {
  Killed: 'diagnostic',
  Timeout: 'diagnostic',
  RuntimeError: 'diagnostic',
  CompileError: 'diagnostic',
  Survived: 'stdout',
  NoCoverage: 'stdout',
  Ignored: 'none',
  Pending: 'none',
}

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
  _tag: 'ReportSpan',
  text,
  tone,
  leftPad: 0,
  rightPad: 0,
  repeat: 1,
})

const plain = (text: string): ReportSpan => spanOf(text, 'plain')

const rule = (fill: string, width: number): ReportSpan => ({
  _tag: 'ReportSpan',
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

type CellFactory = (row: Report.MetricsResult, ancestorCount: number) => CellContent

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
  readonly tone: (row: Report.MetricsResult) => Tone
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
    _tag: 'ReportSpan',
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

const extractReportMutants = (report: Report.MutationTestResult): readonly ReportMutantEntry[] =>
  Object.entries(report.files).flatMap(([fileName, file]) =>
    file.mutants.map((mutant) => ({ fileName, mutant: { ...mutant, fileName }, source: file.source }))
  )

const indexedLine = (lines: readonly string[], index: number): string =>
  Option.getOrElse(Option.fromNullishOr(lines[index]), () => '')

const sourceLine = (source: string, position: Mutant.Position): string =>
  indexedLine(source.split('\n'), position.line - 1)

const tailFromColumn = (raw: string, column: number): readonly string[] =>
  Boolean.match(raw.length === 0, {
    onTrue: () => [],
    onFalse: () => [raw.slice(column - 1)],
  })

const sliceSource = (source: string | undefined, position: Mutant.Position): readonly string[] =>
  Option.match(Option.fromUndefinedOr(source), {
    onNone: () => [],
    onSome: (text) => tailFromColumn(sourceLine(text, position), position.column),
  })

const originalLines = (
  source: string | undefined,
  position: Mutant.Position,
  allowColor: boolean,
): readonly ReportLine[] => {
  const tone = emphasized(allowColor, 'negative')
  return sliceSource(source, position).map((line) => [spanOf('-   ', tone), spanOf(line, tone)])
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

const loggedTests = (mutant: ReportMutant, render: ClearTextRenderOptions): Option.Option<readonly string[]> =>
  Boolean.match(render.logTests, {
    onTrue: () => Option.fromUndefinedOr(mutant.coveredBy),
    onFalse: () => Option.none(),
  })

const coveredTestsTail = (mutant: ReportMutant, render: ClearTextRenderOptions): readonly ReportLine[] =>
  Option.match(loggedTests(mutant, render), {
    onNone: () => [],
    onSome: (tests) => formatCoveredTests(tests, render),
  })

const survivorTail = (mutant: ReportMutant, render: ClearTextRenderOptions): readonly ReportLine[] =>
  Boolean.match(mutant.static === true, {
    onTrue: () => [[plain('Ran all tests for this mutant.')]],
    onFalse: () => coveredTestsTail(mutant, render),
  })

const killerTail = (mutant: ReportMutant): readonly ReportLine[] =>
  Option.match(Option.flatMap(Option.fromUndefinedOr(mutant.killedBy), Arr.head), {
    onNone: () => [],
    onSome: (killer) => [[plain('Killed by: '), plain(killer)]],
  })

const statusReasonTail = (mutant: ReportMutant): readonly ReportLine[] =>
  Option.match(Option.fromUndefinedOr(mutant.statusReason), {
    onNone: () => [],
    onSome: (statusReason) => [[plain('Error message: '), plain(statusReason)]],
  })

const statusTail = (mutant: ReportMutant, render: ClearTextRenderOptions): readonly ReportLine[] =>
  Match.value(mutant.status).pipe(
    Match.when('Survived', () => survivorTail(mutant, render)),
    Match.when('Killed', () => killerTail(mutant)),
    Match.whenOr('RuntimeError', 'CompileError', () => statusReasonTail(mutant)),
    Match.orElse((): readonly ReportLine[] => []),
  )

const completedTests = (entry: ReportMutantEntry): number =>
  Option.getOrElse(Option.fromUndefinedOr(entry.mutant.testsCompleted), () => 0)

const chunkListFor = (entries: readonly ReportMutantEntry[], channel: ReportChannel, render: ClearTextRenderOptions) =>
  entries
    .filter((entry) => CHANNEL_BY_STATUS[entry.mutant.status] === channel)
    .flatMap((entry) => mutantBlock(entry, render))

const mutantBlock = (entry: ReportMutantEntry, render: ClearTextRenderOptions): readonly ReportChunk[] =>
  [
    mutantHeader(entry.mutant.status, entry.mutant.mutatorName, render.allowEmojis),
    sourceLocation(entry.fileName, entry.mutant.location.start, render.allowColor),
    ...originalLines(entry.source, entry.mutant.location.start, render.allowColor),
    ...replacementLines(entry.mutant.replacement, render.allowColor),
    ...statusTail(entry.mutant, render),
    EMPTY_LINE,
  ].map(chunkOf)

interface ReportSections {
  readonly stdout: readonly ReportChunk[]
  readonly diagnostics: readonly ReportChunk[]
}

const EMPTY_SECTIONS: ReportSections = { stdout: [], diagnostics: [] }

interface ReportBlocks {
  readonly stdout: readonly ReportChunk[]
  readonly diagnostics: readonly ReportChunk[]
  readonly totalTests: number
}

const collectMutants = (report: Report.MutationTestResult, render: ClearTextRenderOptions): ReportBlocks => {
  const entries = extractReportMutants(report)
  return {
    stdout: chunkListFor(entries, 'stdout', render),
    diagnostics: chunkListFor(entries, 'diagnostic', render),
    totalTests: Arr.reduce(entries, 0, (total, entry) => total + completedTests(entry)),
  }
}

const testsPerMutant = (metrics: Report.MetricsResult, totalTests: number): string => {
  const total = metrics.metrics.totalMutants
  return Boolean.match(total === 0, {
    onTrue: () => '0.00',
    onFalse: () => (totalTests / total).toFixed(2),
  })
}

const testsPerMutantLine = (metrics: Report.MetricsResult, totalTests: number): ReportLine => [
  plain('Ran '),
  plain(testsPerMutant(metrics, totalTests)),
  plain(' tests per mutant on average.'),
]

const mutantReportSection = (
  report: Report.MutationTestResult,
  metrics: Report.MetricsResult,
  render: ClearTextRenderOptions,
): ReportSections =>
  Boolean.match(render.reportMutants, {
    onTrue: () => {
      const blocks = collectMutants(report, render)
      return {
        stdout: [
          chunkOf(EMPTY_LINE),
          ...blocks.stdout,
          chunkOf(testsPerMutantLine(metrics, blocks.totalTests)),
        ],
        diagnostics: blocks.diagnostics,
      }
    },
    onFalse: () => EMPTY_SECTIONS,
  })

const partialScoresVisible = (metrics: Report.MetricsResult, render: ClearTextRenderOptions): boolean =>
  Boolean.match(render.skipFull, {
    onTrue: () => metrics.childResults.some((child) => child.metrics.mutationScore !== 100),
    onFalse: () => true,
  })

const drawsScoreTable = (metrics: Report.MetricsResult, render: ClearTextRenderOptions): boolean =>
  Boolean.match(render.reportScoreTable, {
    onTrue: () => partialScoresVisible(metrics, render),
    onFalse: () => false,
  })

type ScoreType = 'total' | 'covered'

const mutationScoreOf = (scoreType: ScoreType, metrics: Report.MetricsResult['metrics']): number =>
  Match.value(scoreType).pipe(
    Match.when('total', () => metrics.mutationScore),
    Match.when('covered', () => metrics.mutationScoreBasedOnCoveredCode),
    Match.exhaustive,
  )

const scoreText = (scoreType: ScoreType, row: Report.MetricsResult): string => {
  const score = mutationScoreOf(scoreType, row.metrics)
  return Boolean.match(Number.isNaN(score), {
    onTrue: () => 'n/a',
    onFalse: () => score.toFixed(2),
  })
}

const thresholdTone = (thresholds: Options.MutationScoreThresholds, score: number): Tone =>
  Match.value(score).pipe(
    Match.when((present: number) => Number.isNaN(present), (): Tone => 'muted'),
    Match.when((present) => present >= thresholds.high, (): Tone => 'positive'),
    Match.when((present) => present >= thresholds.low, (): Tone => 'warning'),
    Match.orElse((): Tone => 'negative'),
  )

const scoreTone = (
  thresholds: Options.MutationScoreThresholds,
  scoreType: ScoreType,
  allowColor: boolean,
): (row: Report.MetricsResult) => Tone =>
  Boolean.match(allowColor, {
    onTrue: () => (row) => thresholdTone(thresholds, mutationScoreOf(scoreType, row.metrics)),
    onFalse: () => (): Tone => 'plain',
  })

const contentWidth = (content: CellContent): number => content.indent + content.text.length

const determineContentWidth = (row: Report.MetricsResult, cell: CellFactory, ancestorCount: number): number =>
  widest([
    contentWidth(cell(row, ancestorCount)),
    ...row.childResults.map((child) => determineContentWidth(child, cell, ancestorCount + 1)),
  ])

const leafColumn = (
  header: ReportLine,
  style: PadStyle,
  cell: CellFactory,
  tone: (row: Report.MetricsResult) => Tone,
  rows: Report.MetricsResult,
): LeafColumn => ({
  header,
  style,
  cell,
  tone,
  netWidth: widest([determineContentWidth(rows, cell, 0), lineWidth(header)]),
})

const fileCell = (row: Report.MetricsResult, ancestorCount: number): CellContent => ({
  text: Boolean.match(ancestorCount === 0, {
    onTrue: () => FILES_ROOT_NAME,
    onFalse: () => row.name,
  }),
  indent: ancestorCount,
})

const fileColumn = (rows: Report.MetricsResult): LeafColumn =>
  leafColumn([plain('File')], 'file', fileCell, () => 'plain', rows)

const scoreColumn = (
  rows: Report.MetricsResult,
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
  readonly count: (metrics: Report.MetricsResult['metrics']) => number
}

const STATUS_COLUMNS: readonly StatusColumnSpec[] = [
  { emoji: '✅', label: 'killed', count: (metrics) => metrics.killed },
  { emoji: '⌛️', label: 'timeout', count: (metrics) => metrics.timeout },
  { emoji: '👽', label: 'survived', count: (metrics) => metrics.survived },
  { emoji: '🙈', label: 'no cov', count: (metrics) => metrics.noCoverage },
  { emoji: '💥', label: 'errors', count: (metrics) => metrics.runtimeErrors + metrics.compileErrors },
]

const statusHeader = (allowEmojis: boolean, emoji: string, label: string): ReportLine =>
  Boolean.match(allowEmojis, {
    onTrue: () => [plain(emoji), plain(' '), plain(label)],
    onFalse: () => [plain('# '), plain(label)],
  })

const statusColumn = (spec: StatusColumnSpec, allowEmojis: boolean, rows: Report.MetricsResult): LeafColumn =>
  leafColumn(
    statusHeader(allowEmojis, spec.emoji, spec.label),
    'inner',
    (row) => ({ text: spec.count(row.metrics).toString(), indent: 0 }),
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

const createColumns = (metricsResult: Report.MetricsResult, render: ClearTextRenderOptions): readonly GroupColumn[] => [
  groupColumn([plain('')], 'first', [fileColumn(metricsResult)]),
  groupColumn([plain('% Mutation score')], 'inner', [
    scoreColumn(metricsResult, render.thresholds, 'total', render.allowColor),
    scoreColumn(metricsResult, render.thresholds, 'covered', render.allowColor),
  ]),
  ...STATUS_COLUMNS.map((spec) =>
    groupColumn([plain('')], 'inner', [statusColumn(spec, render.allowEmojis, metricsResult)])
  ),
]

const leafRules = (columns: readonly GroupColumn[]): readonly ReportLine[] =>
  columns.flatMap((column) => column.leaves.map((leaf) => [rule('-', slotWidthOf(leaf))]))

const leafHeaders = (columns: readonly GroupColumn[]): readonly ReportLine[] =>
  columns.flatMap((column) => column.leaves.map((leaf) => placedLine(leaf.header, leaf.style, leaf.netWidth)))

const fullRowVisible = (render: ClearTextRenderOptions, row: Report.MetricsResult): boolean =>
  Boolean.match(render.skipFull, {
    onTrue: () => row.metrics.mutationScore !== 100,
    onFalse: () => true,
  })

const bodyRow = (columns: readonly GroupColumn[], row: Report.MetricsResult, ancestorCount: number): ReportLine =>
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
  row: Report.MetricsResult,
  ancestorCount: number,
) =>
  Boolean.match(fullRowVisible(render, row), {
    onTrue: () => [bodyRow(columns, row, ancestorCount)],
    onFalse: () => [],
  })

const bodyRows = (
  columns: readonly GroupColumn[],
  render: ClearTextRenderOptions,
  current: Report.MetricsResult,
  ancestorCount: number,
): readonly ReportLine[] => [
  ...ownRow(columns, render, current, ancestorCount),
  ...current.childResults.flatMap((child) => bodyRows(columns, render, child, ancestorCount + 1)),
]

const scoreTable = (metricsResult: Report.MetricsResult, render: ClearTextRenderOptions): ReportChunk => {
  const columns = createColumns(metricsResult, render)
  return [
    rowOfLines(columns.map((column) => [rule('-', slotWidthOf(column))])),
    rowOfLines(columns.map((column) => placedLine(column.header, column.style, column.netWidth))),
    rowOfLines(leafHeaders(columns)),
    rowOfLines(leafRules(columns)),
    ...bodyRows(columns, render, metricsResult, 0),
    rowOfLines(leafRules(columns)),
  ]
}

const scoreTableOf = (metrics: Report.MetricsResult, render: ClearTextRenderOptions): Option.Option<ReportChunk> =>
  Boolean.match(drawsScoreTable(metrics, render), {
    onTrue: () => Option.some(scoreTable(metrics, render)),
    onFalse: () => Option.none(),
  })

const renderClearText = (
  report: Report.MutationTestResult,
  metrics: Report.MetricsResult,
  render: ClearTextRenderOptions,
): ReportSections => {
  const section = mutantReportSection(report, metrics, render)
  return {
    stdout: [chunkOf(EMPTY_LINE), ...section.stdout, ...Option.toArray(scoreTableOf(metrics, render))],
    diagnostics: section.diagnostics,
  }
}

export const renderClearTextReport = Workflow.make({
  command: ClearTextReportCommand,
  decision: ClearTextReportDecision,
  error: S.Never,
  decide: (command) =>
    Option.match(
      Option.all([Option.fromUndefinedOr(command.reported), Option.fromUndefinedOr(command.computed)]),
      {
        onNone: () => Result.succeed(ClearTextReportSuppressed.make({})),
        onSome: ([report, metrics]) => {
          const sections = renderClearText(report, metrics, command.render)
          return Result.succeed(
            ClearTextReportRendered.make({
              stdout: [...sections.stdout],
              diagnostics: [...sections.diagnostics],
              stderr: Boolean.match(command.render.debug, {
                onTrue: () => [...sections.diagnostics],
                onFalse: () => [],
              }),
            }),
          )
        },
      },
    ),
})
