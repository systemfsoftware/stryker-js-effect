import type { MutantStatus } from '@systemfsoftware/stryker-js-instrumenter'
import type { Position } from '@systemfsoftware/stryker-js-instrumenter'
import type * as reportApi from '@systemfsoftware/stryker-js-plugin-interface'
import {
  MetricsResultSchema,
  MutationScoreThresholdsSchema,
  MutationTestResultSchema,
} from '@systemfsoftware/stryker-js-plugin-interface'
import type { MetricsResult } from '@systemfsoftware/stryker-js-plugin-interface'
import type { MutationScoreThresholds } from '@systemfsoftware/stryker-js-plugin-interface'
import { Workflow } from '@systemfsoftware/effect-cell-types'
import type { NonEmptyReadonlyArray } from 'effect/Array'
import * as Arr from 'effect/Array'
import * as Boolean from 'effect/Boolean'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import { ansi } from './Reporter.ansi.js'

const ClearTextReportTypeId: unique symbol = Symbol.for('@systemfsoftware/stryker-js/ClearTextReport')
type ClearTextReportTypeId = typeof ClearTextReportTypeId

export const ClearTextRenderOptions = S.Struct({
  allowColor: S.Boolean,
  allowEmojis: S.Boolean,
  logTests: S.Boolean,
  maxTestsToLog: S.Finite,
  reportMutants: S.Boolean,
  reportScoreTable: S.Boolean,
  skipFull: S.Boolean,
  debug: S.Boolean,
  thresholds: MutationScoreThresholdsSchema,
})
export type ClearTextRenderOptions = typeof ClearTextRenderOptions.Type

export class ClearTextReportCommand extends S.TaggedClass<ClearTextReportCommand>()('ClearTextReportCommand', {
  reported: S.optional(MutationTestResultSchema),
  computed: S.optional(MetricsResultSchema),
  render: ClearTextRenderOptions,
  rendered: S.Boolean,
}) {
  static readonly [Workflow.InstrumentationBrand] = { rendered: 'stryker.report.render' } as const
}

export class ClearTextReportRendered extends S.TaggedClass<ClearTextReportRendered>()('ClearTextReportRendered', {
  stdout: S.Array(S.String),
  diagnostics: S.Array(S.String),
}) {
  readonly [ClearTextReportTypeId] = ClearTextReportTypeId
}

export class ClearTextReportSuppressed extends S.TaggedClass<ClearTextReportSuppressed>()('ClearTextReportSuppressed', {}) {
  readonly [ClearTextReportTypeId] = ClearTextReportTypeId
}

export const ClearTextReportDecision = S.Union([ClearTextReportRendered, ClearTextReportSuppressed])
export type ClearTextReportDecision = typeof ClearTextReportDecision.Type

type ReportMutant = reportApi.MutantResult & { fileName: string }

interface ReportMutantEntry {
  readonly fileName: string
  readonly mutant: ReportMutant
  readonly source: string | undefined
}

type ReportChannel = 'stdout' | 'debug' | 'none'

const REPORT_CHANNEL: Record<MutantStatus, ReportChannel> = {
  Killed: 'debug',
  Timeout: 'debug',
  RuntimeError: 'debug',
  CompileError: 'debug',
  Survived: 'stdout',
  NoCoverage: 'stdout',
  Ignored: 'none',
  Pending: 'none',
}

const EMOJI_BY_STATUS: Record<MutantStatus, string> = {
  'Killed': '✅',
  'NoCoverage': '🙈',
  'Ignored': '🤥',
  'Survived': '👽',
  'Timeout': '⏰',
  'Pending': '⌛',
  'RuntimeError': '💥',
  'CompileError': '💥',
}

const colored = (allowColor: boolean, color: (text: string) => string, text: string) =>
  Boolean.match(allowColor, {
    onTrue: () => color(text),
    onFalse: () => text,
  })

const sourceLocation = (fileName: string, position: Position, allowColor: boolean) =>
  [
    colored(allowColor, ansi.cyan, fileName),
    colored(allowColor, ansi.yellow, String(position.line)),
    colored(allowColor, ansi.yellow, String(position.column)),
  ].join(':')

const mutantLabel = (status: MutantStatus, allowEmojis: boolean) =>
  Boolean.match(allowEmojis, {
    onTrue: () => `${EMOJI_BY_STATUS[status]} ${status}`,
    onFalse: () => status,
  })

const extractReportMutants = (report: reportApi.MutationTestResult): readonly ReportMutantEntry[] =>
  Object.entries(report.files).flatMap(([fileName, file]) =>
    file.mutants.map((mutant) => ({ fileName, mutant: { ...mutant, fileName }, source: file.source })))

const sourceLine = (source: string, position: Position) => source.split('\n')[position.line - 1] ?? ''

const tailFromColumn = (raw: string, column: number): readonly string[] =>
  Boolean.match(raw.length === 0, {
    onTrue: () => [],
    onFalse: () => [raw.slice(column)],
  })

const sliceSource = (source: string | undefined, position: Position): readonly string[] =>
  Option.match(Option.fromUndefinedOr(source), {
    onNone: () => [],
    onSome: (text) => tailFromColumn(sourceLine(text, position), position.column),
  })

const originalLines = (source: string | undefined, position: Position, allowColor: boolean): readonly string[] =>
  sliceSource(source, position).map((line) => colored(allowColor, ansi.red, `-   ${line}`))

const replacementLines = (replacement: string | undefined, allowColor: boolean): readonly string[] =>
  Option.match(Option.fromUndefinedOr(replacement), {
    onNone: () => [],
    onSome: (text) =>
      text
        .split('\n')
        .filter((line) => line !== '')
        .map((line) => colored(allowColor, ansi.green, `+   ${line}`)),
  })

const formatCoveredTests = (tests: readonly string[], render: ClearTextRenderOptions): readonly string[] => {
  const logged = Math.min(render.maxTestsToLog, tests.length)
  return Boolean.match(logged <= 0, {
    onTrue: () => [],
    onFalse: () => [
      'Tests ran:',
      ...tests.slice(0, logged).map((test) => `    ${test}`),
      ...overflowNotice(tests.length - render.maxTestsToLog),
      '',
    ],
  })
}

const coveredTestsTail = (mutant: ReportMutant, render: ClearTextRenderOptions): readonly string[] =>
  Option.match(Option.fromUndefinedOr(render.logTests ? mutant.coveredBy : undefined), {
    onNone: () => [],
    onSome: (tests) => formatCoveredTests(tests, render),
  })

const survivorTail = (mutant: ReportMutant, render: ClearTextRenderOptions): readonly string[] =>
  Boolean.match(mutant.static === true, {
    onTrue: () => ['Ran all tests for this mutant.'],
    onFalse: () => coveredTestsTail(mutant, render),
  })

const killerTail = (mutant: ReportMutant): readonly string[] =>
  Option.match(Option.fromUndefinedOr(mutant.killedBy), {
    onNone: () => [],
    onSome: (killedBy) => Option.match(Option.fromUndefinedOr(killedBy[0]), {
      onNone: () => [],
      onSome: (killer) => [`Killed by: ${killer}`],
    }),
  })

const statusReasonTail = (mutant: ReportMutant): readonly string[] =>
  Option.match(Option.fromUndefinedOr(mutant.statusReason), {
    onNone: () => [],
    onSome: (statusReason) => [`Error message: ${statusReason}`],
  })

const statusTail = (mutant: ReportMutant, render: ClearTextRenderOptions): readonly string[] =>
  Match.value(mutant.status).pipe(
    Match.when('Survived', () => survivorTail(mutant, render)),
    Match.when('Killed', () => killerTail(mutant)),
    Match.whenOr('RuntimeError', 'CompileError', () => statusReasonTail(mutant)),
    Match.orElse((): readonly string[] => []),
  )

const plural = (items: number) =>
  Boolean.match(items > 1, {
    onTrue: () => 's',
    onFalse: () => '',
  })

const overflowNotice = (hidden: number): readonly string[] =>
  Boolean.match(hidden <= 0, {
    onTrue: () => [],
    onFalse: () => [`  and ${hidden} more test${plural(hidden)}!`],
  })

const mutantBlock = (
  fileName: string,
  mutant: ReportMutant,
  source: string | undefined,
  render: ClearTextRenderOptions,
): readonly string[] => [
  `[${mutantLabel(mutant.status, render.allowEmojis)}] ${mutant.mutatorName}`,
  sourceLocation(fileName, mutant.location.start, render.allowColor),
  ...originalLines(source, mutant.location.start, render.allowColor),
  ...replacementLines(mutant.replacement, render.allowColor),
  ...statusTail(mutant, render),
  '',
]

interface ReportBlocks {
  readonly stdout: readonly string[]
  readonly debug: readonly string[]
  readonly totalTests: number
}

const linesForChannel = (
  entries: readonly ReportMutantEntry[],
  channel: ReportChannel,
  render: ClearTextRenderOptions,
): readonly string[] =>
  entries
    .filter((entry) => REPORT_CHANNEL[entry.mutant.status] === channel)
    .flatMap((entry) => mutantBlock(entry.fileName, entry.mutant, entry.source, render))

const collectMutants = (
  report: reportApi.MutationTestResult,
  render: ClearTextRenderOptions,
): ReportBlocks => {
  const entries = extractReportMutants(report)
  return {
    stdout: linesForChannel(entries, 'stdout', render),
    debug: linesForChannel(entries, 'debug', render),
    totalTests: Arr.reduce(entries, 0, (total, entry) => total + (entry.mutant.testsCompleted ?? 0)),
  }
}

const partialScoresVisible = (metrics: MetricsResult, render: ClearTextRenderOptions) =>
  Boolean.match(render.skipFull, {
    onTrue: () => metrics.childResults.some((child) => child.metrics.mutationScore !== 100),
    onFalse: () => true,
  })

const drawsScoreTable = (metrics: MetricsResult, render: ClearTextRenderOptions) =>
  render.reportScoreTable && partialScoresVisible(metrics, render)

const testsPerMutant = (metrics: MetricsResult, totalTests: number) => {
  const total = metrics.metrics.totalMutants
  return Boolean.match(total === 0, {
    onTrue: () => '0.00',
    onFalse: () => (totalTests / total).toFixed(2),
  })
}

interface ReportLines {
  readonly stdout: readonly string[]
  readonly debug: readonly string[]
}

const EMPTY_REPORT_LINES: ReportLines = { stdout: [], debug: [] }

const mutantReportSection = (
  report: reportApi.MutationTestResult,
  metrics: MetricsResult,
  render: ClearTextRenderOptions,
): ReportLines =>
  Boolean.match(render.reportMutants, {
    onTrue: () => {
      const blocks = collectMutants(report, render)
      return {
        stdout: [
          '',
          ...blocks.stdout,
          `Ran ${testsPerMutant(metrics, blocks.totalTests)} tests per mutant on average.`,
        ],
        debug: blocks.debug,
      }
    },
    onFalse: () => EMPTY_REPORT_LINES,
  })

const KNOWN_EMOJI: Record<string, true> = {
  '✅': true,
  '🙈': true,
  '🤥': true,
  '👽': true,
  '⏰': true,
  '⌛': true,
  '💥': true,
}

const charWidth = (char: string): number =>
  Match.value(char).pipe(
    Match.when((candidate) => KNOWN_EMOJI[candidate] === true, () => 2),
    Match.when((candidate) => (candidate.codePointAt(0) ?? 0) > 0xffff, () => 2),
    Match.orElse(() => 1),
  )

const stringWidth = (input: string): number => Array.from(input).reduce((width, char) => width + charWidth(char), 0)

const FILES_ROOT_NAME = 'All files'

type TableCellValueFactory = (
  row: MetricsResult,
  ancestorCount: number,
) => string

const repeat = (char: string, nTimes: number) => char.repeat(Math.max(nTimes, 0))
const spaces = (n: number) => repeat(' ', n)

const statusHeader = (allowEmojis: boolean, emoji: string, label: string) =>
  Boolean.match(allowEmojis, {
    onTrue: () => `${emoji} ${label}`,
    onFalse: () => `# ${label}`,
  })

const maxOf = (values: readonly number[]) =>
  Arr.reduce(values, Number.NEGATIVE_INFINITY, (acc, cur) => Math.max(acc, cur))

const widthOrZero = (width: number): number =>
  Match.value(width === Number.NEGATIVE_INFINITY).pipe(
    Match.when(true, () => 0),
    Match.when(false, () => width),
    Match.exhaustive,
  )

const determineContentWidth = (
  row: MetricsResult,
  valueFactory: TableCellValueFactory,
  ancestorCount = 0,
): number => {
  const head = valueFactory(row, ancestorCount).length
  const childWidths = row.childResults.map((child) => determineContentWidth(child, valueFactory, ancestorCount + 1))
  return widthOrZero(maxOf([head, ...childWidths]))
}

type Column =
  | {
    readonly kind: 'single'
    readonly header: string
    readonly isFirstColumn: boolean
    readonly netWidth: number
    readonly valueFactory: TableCellValueFactory
    readonly rows: MetricsResult
  }
  | {
    readonly kind: 'file'
    readonly header: string
    readonly isFirstColumn: true
    readonly netWidth: number
    readonly valueFactory: TableCellValueFactory
    readonly rows: MetricsResult
  }
  | {
    readonly kind: 'mutationScore'
    readonly header: string
    readonly isFirstColumn: false
    readonly netWidth: number
    readonly valueFactory: TableCellValueFactory
    readonly rows: MetricsResult
    readonly thresholds: MutationScoreThresholds
    readonly scoreType: 'total' | 'covered'
    readonly allowColor: boolean
  }
  | {
    readonly kind: 'group'
    readonly header: string
    readonly isFirstColumn: boolean
    readonly netWidth: number
    readonly columns: readonly Column[]
  }

const columnWidth = (column: Column) =>
  Boolean.match(column.isFirstColumn, {
    onTrue: () => column.netWidth + 1,
    onFalse: () => column.netWidth + 2,
  })

const padColumn = (column: Column, input: string): string =>
  Match.value(column.kind === 'file').pipe(
    Match.when(true, () => `${input}${spaces(columnWidth(column) - stringWidth(input))}`),
    Match.when(false, () =>
      Match.value(column.isFirstColumn).pipe(
        Match.when(true, () => `${spaces(column.netWidth - stringWidth(input))}${input} `),
        Match.when(false, () => `${spaces(column.netWidth - stringWidth(input))} ${input} `),
        Match.exhaustive,
      )),
    Match.exhaustive,
  )

const drawLine = (column: Column): string => repeat('-', columnWidth(column))

const drawHeader = (column: Column): string => padColumn(column, column.header)

type MutationScoreColumn = Extract<Column, { readonly kind: 'mutationScore' }>

const mutationScoreOf = (scoreType: 'total' | 'covered', metrics: MetricsResult['metrics']): number =>
  Match.value(scoreType).pipe(
    Match.when('total', () => metrics.mutationScore),
    Match.when('covered', () => metrics.mutationScoreBasedOnCoveredCode),
    Match.exhaustive,
  )

const thresholdColor = (thresholds: MutationScoreThresholds, value: number): (input: string) => string =>
  Match.value(value).pipe(
    Match.when((present: number) => Number.isNaN(present), () => ansi.grey),
    Match.when((present) => present >= thresholds.high, () => ansi.green),
    Match.when((present) => present >= thresholds.low, () => ansi.yellow),
    Match.orElse(() => ansi.red),
  )

const scoreColor = (column: MutationScoreColumn, score: MetricsResult): (input: string) => string =>
  Boolean.match(column.allowColor, {
    onTrue: () => thresholdColor(column.thresholds, mutationScoreOf(column.scoreType, score.metrics)),
    onFalse: () => (input: string) => input,
  })

const colorFor = (column: Column, score: MetricsResult): (input: string) => string =>
  Match.value(column).pipe(
    Match.discriminator('kind')('mutationScore', (scored) => scoreColor(scored, score)),
    Match.orElse(() => (input: string): string => input),
  )

type TableLeafColumn = Extract<Column, { readonly valueFactory: TableCellValueFactory }>

const drawLeafCell = (leaf: TableLeafColumn, score: MetricsResult, ancestorCount: number): string =>
  colorFor(leaf, score)(padColumn(leaf, leaf.valueFactory(score, ancestorCount)))

const drawTableCell = (column: Column, score: MetricsResult, ancestorCount: number): string =>
  Match.value(column).pipe(
    Match.discriminator('kind')('group', (grouped) =>
      grouped.columns.map((child) => drawTableCell(child, score, ancestorCount)).join('|')),
    Match.discriminator('kind')('single', (leaf) => drawLeafCell(leaf, score, ancestorCount)),
    Match.discriminator('kind')('file', (leaf) => drawLeafCell(leaf, score, ancestorCount)),
    Match.discriminator('kind')('mutationScore', (leaf) => drawLeafCell(leaf, score, ancestorCount)),
    Match.exhaustive,
  )

const drawColumnHeaders = (column: Column) =>
  Match.value(column).pipe(
    Match.discriminator('kind')('group', (grouped) => grouped.columns.map((c) => drawHeader(c)).join('|')),
    Match.orElse(drawHeader),
  )

const drawColumnLines = (column: Column) =>
  Match.value(column).pipe(
    Match.discriminator('kind')('group', (grouped) => grouped.columns.map((c) => drawLine(c)).join('|')),
    Match.orElse(drawLine),
  )

const makeSingleColumn = (
  header: string,
  isFirstColumn: boolean,
  valueFactory: TableCellValueFactory,
  rows: MetricsResult,
): Column => {
  const maxContentSize = determineContentWidth(rows, valueFactory)
  const netWidth = maxOf([maxContentSize, stringWidth(header)])
  return {
    kind: 'single',
    header,
    isFirstColumn,
    netWidth: widthOrZero(netWidth),
    valueFactory,
    rows,
  }
}

const makeFileColumn = (rows: MetricsResult): Column => {
  const valueFactory: TableCellValueFactory = (row, ancestorCount) =>
    Boolean.match(ancestorCount === 0, {
      onTrue: () => spaces(ancestorCount) + FILES_ROOT_NAME,
      onFalse: () => spaces(ancestorCount) + row.name,
    })
  const netWidth = maxOf([determineContentWidth(rows, valueFactory), stringWidth('File')])
  return {
    kind: 'file',
    header: 'File',
    isFirstColumn: true,
    netWidth: widthOrZero(netWidth),
    valueFactory,
    rows,
  }
}

const makeMutationScoreColumn = (
  rows: MetricsResult,
  thresholds: MutationScoreThresholds,
  scoreType: 'total' | 'covered',
  allowColor: boolean,
): Column => {
  const valueFactory: TableCellValueFactory = (row) =>
    Match.value(mutationScoreOf(scoreType, row.metrics)).pipe(
      Match.when((present: number) => Number.isNaN(present), () => 'n/a'),
      Match.orElse((present) => present.toFixed(2)),
    )
  const netWidth = maxOf([determineContentWidth(rows, valueFactory), stringWidth(scoreType)])
  return {
    kind: 'mutationScore',
    header: scoreType,
    isFirstColumn: false,
    netWidth: widthOrZero(netWidth),
    valueFactory,
    rows,
    thresholds,
    scoreType,
    allowColor,
  }
}

const paddingWidth = (isFirstColumn: boolean) =>
  Boolean.match(isFirstColumn, {
    onTrue: () => 1,
    onFalse: () => 2,
  })

const widthAdjustedColumns: (
  columns: NonEmptyReadonlyArray<Column>,
  first: Column,
  columnsWidth: number,
  netWidth: number,
) => readonly Column[] = (
  columns: readonly Column[],
  first: Column,
  columnsWidth: number,
  netWidth: number,
): readonly Column[] =>
  Boolean.match(netWidth > columnsWidth + 1, {
    onTrue: () => [
      { ...first, netWidth: first.netWidth + (netWidth - columnsWidth - 1) },
      ...columns.slice(1),
    ],
    onFalse: () => columns,
  })

const makeGroupColumn = (groupName: string, columns: NonEmptyReadonlyArray<Column>): Column => {
  const [first, ...rest] = columns
  const columnsWidth = rest.reduce((acc, cur) => acc + columnWidth(cur), columnWidth(first)) -
    paddingWidth(first.isFirstColumn)
  const netWidth = widthOrZero(maxOf([stringWidth(groupName), columnsWidth]))
  return {
    kind: 'group',
    header: groupName,
    isFirstColumn: first.isFirstColumn,
    netWidth,
    columns: widthAdjustedColumns(columns, first, columnsWidth, netWidth),
  }
}

const createColumns = (metricsResult: MetricsResult, render: ClearTextRenderOptions): readonly Column[] => [
  makeGroupColumn('', [makeFileColumn(metricsResult)]),
  makeGroupColumn('% Mutation score', [
    makeMutationScoreColumn(metricsResult, render.thresholds, 'total', render.allowColor),
    makeMutationScoreColumn(metricsResult, render.thresholds, 'covered', render.allowColor),
  ]),
  makeGroupColumn('', [
    makeSingleColumn(
      statusHeader(render.allowEmojis, '✅', 'killed'),
      false,
      (row) => row.metrics.killed.toString(),
      metricsResult,
    ),
  ]),
  makeGroupColumn('', [
    makeSingleColumn(
      statusHeader(render.allowEmojis, '⌛️', 'timeout'),
      false,
      (row) => row.metrics.timeout.toString(),
      metricsResult,
    ),
  ]),
  makeGroupColumn('', [
    makeSingleColumn(
      statusHeader(render.allowEmojis, '👽', 'survived'),
      false,
      (row) => row.metrics.survived.toString(),
      metricsResult,
    ),
  ]),
  makeGroupColumn('', [
    makeSingleColumn(
      statusHeader(render.allowEmojis, '🙈', 'no cov'),
      false,
      (row) => row.metrics.noCoverage.toString(),
      metricsResult,
    ),
  ]),
  makeGroupColumn('', [
    makeSingleColumn(
      statusHeader(render.allowEmojis, '💥', 'errors'),
      false,
      (row) => (row.metrics.runtimeErrors + row.metrics.compileErrors).toString(),
      metricsResult,
    ),
  ]),
]

const drawRow = (
  columns: readonly Column[],
  toDraw: (col: Column) => string,
): string => `${columns.map(toDraw).join('|')}|`

const drawTableBody = (
  columns: readonly Column[],
  render: ClearTextRenderOptions,
  current: MetricsResult,
  ancestorCount: number,
): readonly string[] => {
  const ownRow = Boolean.match(
    render.skipFull === false || current.metrics.mutationScore !== 100,
    {
      onTrue: () => [drawRow(columns, (column) => drawTableCell(column, current, ancestorCount))],
      onFalse: (): readonly string[] => [],
    },
  )
  const childRows = current.childResults.flatMap((child) => drawTableBody(columns, render, child, ancestorCount + 1))
  return [...ownRow, ...childRows]
}

const EOL = '\n'

const drawMutationScoreTable = (metricsResult: MetricsResult, render: ClearTextRenderOptions): string => {
  const columns = createColumns(metricsResult, render)
  return [
    drawRow(columns, drawLine),
    drawRow(columns, drawHeader),
    drawRow(columns, drawColumnHeaders),
    drawRow(columns, drawColumnLines),
    drawTableBody(columns, render, metricsResult, 0).join(EOL),
    drawRow(columns, drawColumnLines),
  ].join(EOL)
}

const lineIfPresent = (line: string | undefined): readonly string[] =>
  Option.match(Option.fromUndefinedOr(line), {
    onNone: () => [],
    onSome: (present) => [present],
  })

const scoreTableOf = (metrics: MetricsResult, render: ClearTextRenderOptions): string | undefined =>
  Boolean.match(drawsScoreTable(metrics, render), {
    onTrue: () => drawMutationScoreTable(metrics, render),
    onFalse: () => undefined,
  })

const renderClearText = (
  report: reportApi.MutationTestResult,
  metrics: MetricsResult,
  render: ClearTextRenderOptions,
): ReportLines => {
  const section = mutantReportSection(report, metrics, render)
  return {
    stdout: ['', ...section.stdout, ...lineIfPresent(scoreTableOf(metrics, render))],
    debug: [...section.debug],
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
          const rendered = renderClearText(report, metrics, command.render)
          return Result.succeed(
            ClearTextReportRendered.make({ stdout: [...rendered.stdout], diagnostics: [...rendered.debug] }),
          )
        },
      },
    ),
})
