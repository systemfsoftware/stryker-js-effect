import { Cell, Sandwich } from '@systemfsoftware/effect-cell-types'
import { errorToString } from '@systemfsoftware/stryker-js-instrumenter'
import type { MutantStatus, Position } from '@systemfsoftware/stryker-js-instrumenter'
import type * as reportApi from '@systemfsoftware/stryker-js-plugin-interface'
import type { ReporterEvent, ReporterFactory, StrykerOptions } from '@systemfsoftware/stryker-js-plugin-interface'
import { ReporterFailed } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Boolean from 'effect/Boolean'
import type * as Context from 'effect/Context'
import * as Effect from 'effect/Effect'
import * as Filter from 'effect/Filter'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Arr from 'effect/Array'
import * as Result from 'effect/Result'
import * as Sink from 'effect/Sink'
import * as Stream from 'effect/Stream'

import { ansi } from './Reporter.ansi.js'
import {
  ClearTextReportCommand,
  renderClearTextReport,
  type ClearTextRenderOptions,
  type ReportChunk,
  type ReportLine,
  type ReportSpan,
  type Tone,
} from './render-clear-text-report.workflow.js'
import { calculateMetrics } from './calculate-metrics.js'
import { ReporterOutput, type ReporterOutputShape } from './reporter-output.service.js'

const failAsClearText = <E = unknown>(cause: E): ReporterFailed =>
  ReporterFailed.make({
    reporterName: 'clear-text',
    event: 'mutationTestReportReady',
    cause: errorToString(cause),
  })

interface TerminalReport {
  readonly report: reportApi.MutationTestResult
  readonly metrics: reportApi.MetricsResult
}

const terminalReportOf = Filter.make((event: ReporterEvent): Result.Result<TerminalReport, 'not-terminal'> =>
  Match.value(event).pipe(
    Match.tag('mutationTestReportReady', (ready) => Result.succeed({ report: ready.report, metrics: ready.metrics })),
    Match.orElse(() => Result.fail('not-terminal' as const)),
  ))

const renderOptionsOf = (options: StrykerOptions): ClearTextRenderOptions => ({
  allowColor: options.clearTextReporter.allowColor,
  allowEmojis: options.clearTextReporter.allowEmojis,
  logTests: options.clearTextReporter.logTests,
  maxTestsToLog: options.clearTextReporter.maxTestsToLog,
  reportMutants: options.clearTextReporter.reportMutants,
  reportScoreTable: options.clearTextReporter.reportScoreTable,
  skipFull: options.clearTextReporter.skipFull,
  debug: options.logLevel === 'debug',
  thresholds: options.thresholds,
})

const readClearTextReport = (input: {
  readonly options: StrykerOptions
  readonly events: AsyncIterable<ReporterEvent>
}) =>
  Effect.map(
    Stream.fromAsyncIterable(input.events, failAsClearText).pipe(
      Stream.filterMap(terminalReportOf),
      Stream.run(Sink.last<TerminalReport>()),
    ),
    (terminal) => ({
      _tag: 'ClearTextReportCommand' as const,
      reported: Option.match(terminal, {
        onNone: () => undefined,
        onSome: (ready) => ready.report,
      }),
      computed: Option.match(terminal, {
        onNone: () => undefined,
        onSome: (ready) => ready.metrics,
      }),
      render: renderOptionsOf(input.options),
      rendered: true,
    }),
  )

const TINT_BY_TONE: Record<Tone, (text: string) => string> = {
  'plain': (text) => text,
  'identifier': ansi.cyan,
  'emphasis': ansi.yellow,
  'positive': ansi.green,
  'warning': ansi.yellow,
  'negative': ansi.red,
  'muted': ansi.grey,
}

const runsMergeable = (left: ReportSpan, right: ReportSpan): boolean =>
  Arr.every(
    [
      left.tone === right.tone,
      left.leftPad === right.leftPad,
      left.rightPad === right.rightPad,
      left.repeat === 1,
      right.repeat === 1,
    ],
    (holds) => holds,
  )

const mergeInto = (runs: readonly ReportSpan[], span: ReportSpan): readonly ReportSpan[] =>
  Option.match(Arr.last(runs), {
    onNone: () => [span],
    onSome: (last) =>
      Boolean.match(runsMergeable(last, span), {
        onTrue: () => [...runs.slice(0, -1), { ...last, text: `${last.text}${span.text}` }],
        onFalse: () => [...runs, span],
      }),
  })

const runsOf = (line: ReportLine): readonly ReportSpan[] => Arr.reduce(line, [], mergeInto)

const renderSpan = (span: ReportSpan): string =>
  TINT_BY_TONE[span.tone](
    `${' '.repeat(span.leftPad)}${span.text.repeat(span.repeat)}${' '.repeat(span.rightPad)}`,
  )

const renderLine = (line: ReportLine): string => runsOf(line).map(renderSpan).join('')

const renderChunk = (chunk: ReportChunk): string => chunk.map(renderLine).join('\n')

const writeChunks = (
  output: ReporterOutputShape,
  channel: 'stdout' | 'stderr',
  chunks: readonly ReportChunk[],
): Effect.Effect<void, ReporterFailed> =>
  output.write(channel, chunks.map((chunk) => `${renderChunk(chunk)}\n`)).pipe(
    Effect.mapError(failAsClearText),
    Effect.asVoid,
  )

export const clearTextReportCell = Sandwich.named('stryker.report.clearText')(readClearTextReport)
  .decide(renderClearTextReport)
  .write({
    ClearTextReportRendered: (rendered, raw) =>
      Effect.gen(function*() {
        const output = yield* ReporterOutput
        yield* writeChunks(output, 'stdout', rendered.stdout)
        yield* Boolean.match(raw.render.debug, {
          onTrue: () => writeChunks(output, 'stderr', rendered.diagnostics),
          onFalse: () => Effect.void,
        })
      }),
    ClearTextReportSuppressed: () => Effect.void,
    CommandRejected: ({ issue }) => Effect.fail(failAsClearText(issue)),
  })

export const clearTextReporterFactory = (context: Context.Context<ReporterOutput>): ReporterFactory => {
  const report = Cell.provideContext(clearTextReportCell, context)
  return (options) => (events) => Effect.asVoid(report.run({ options, events }))
}

if (import.meta.vitest !== void 0) {
  const { it } = await import('@effect/vitest')
  const Schema = await import('effect/Schema')
  const Arbitrary = await import('effect/unstable/arbitrary/Arbitrary')

  const legacyPlural = (items: number): string => {
    if (items > 1) {
      return 's'
    }
    return ''
  }

  const legacyEmoji: Record<MutantStatus, string> = {
    'Killed': '✅',
    'NoCoverage': '🙈',
    'Ignored': '🤥',
    'Survived': '👽',
    'Timeout': '⏰',
    'Pending': '⌛',
    'RuntimeError': '💥',
    'CompileError': '💥',
  }

  const legacySourceLocation = (fileName: string, position: Position, allowColor: boolean): string => {
    const file = (() => {
      if (allowColor) {
        return ansi.cyan(fileName)
      }
      return fileName
    })()
    const line = (() => {
      if (allowColor) {
        return ansi.yellow(String(position.line))
      }
      return String(position.line)
    })()
    const col = (() => {
      if (allowColor) {
        return ansi.yellow(String(position.column))
      }
      return String(position.column)
    })()
    return [file, line, col].join(':')
  }

  const legacyMutantLabel = (status: MutantStatus, allowEmojis: boolean): string => {
    if (allowEmojis) {
      return `${legacyEmoji[status]} ${status}`
    }
    return status
  }

  interface LegacyEntry {
    readonly fileName: string
    readonly mutant: ReportMutant
    readonly source: string | undefined
  }

  const LEGACY_CHANNEL: Record<MutantStatus, 'stdout' | 'debug' | 'none'> = {
    Killed: 'debug',
    Timeout: 'debug',
    RuntimeError: 'debug',
    CompileError: 'debug',
    Survived: 'stdout',
    NoCoverage: 'stdout',
    Ignored: 'none',
    Pending: 'none',
  }

  const legacyExtract = (report: reportApi.MutationTestResult): readonly LegacyEntry[] =>
    Object.entries(report.files).flatMap(([fileName, file]) =>
      file.mutants.map((mutant) => ({ fileName, mutant: { ...mutant, fileName }, source: file.source })))

  const legacySourceLine = (source: string, position: Position): string => {
    const raw = source.split('\n')[position.line - 1]
    if (raw === undefined) return ''
    return raw
  }

  const legacyTail = (raw: string, column: number): string[] => {
    if (raw.length === 0) return []
    return [raw.slice(column)]
  }

  const legacySlice = (source: string | undefined, position: Position): string[] => {
    if (source === undefined) return []
    return legacyTail(legacySourceLine(source, position), position.column)
  }

  const legacyOriginalLines = (source: string | undefined, position: Position, allowColor: boolean): string[] =>
    legacySlice(source, position).map((l) => {
      if (allowColor) {
        return ansi.red(`-   ${l}`)
      }
      return `-   ${l}`
    })

  const legacyReplacementLines = (replacement: string | undefined, allowColor: boolean): string[] => {
    if (replacement === undefined) return []
    return replacement
      .split('\n')
      .filter(Boolean)
      .map((l) => {
        if (allowColor) {
          return ansi.green(`+   ${l}`)
        }
        return `+   ${l}`
      })
  }

  const legacyCoveredTail = (mutant: ReportMutant, render: ClearTextRenderOptions): string[] => {
    if (!render.logTests) return []
    if (mutant.coveredBy === undefined) return []
    return legacyCoveredTests(mutant.coveredBy, render)
  }

  const legacySurvivorTail = (mutant: ReportMutant, render: ClearTextRenderOptions): string[] => {
    if (mutant.static === true) return ['Ran all tests for this mutant.']
    return legacyCoveredTail(mutant, render)
  }

  const legacyKillerTail = (mutant: ReportMutant): string[] => {
    const killedBy = mutant.killedBy
    if (killedBy === undefined) return []
    const killer = killedBy[0]
    if (killer === undefined) return []
    return [`Killed by: ${killer}`]
  }

  const legacyStatusReasonTail = (mutant: ReportMutant): string[] => {
    if (mutant.statusReason === undefined) return []
    return [`Error message: ${mutant.statusReason}`]
  }

  const legacyStatusTail = (mutant: ReportMutant, render: ClearTextRenderOptions): string[] =>
    Match.value(mutant.status).pipe(
      Match.when('Survived', () => legacySurvivorTail(mutant, render)),
      Match.when('Killed', () => legacyKillerTail(mutant)),
      Match.whenOr('RuntimeError', 'CompileError', () => legacyStatusReasonTail(mutant)),
      Match.orElse((): string[] => []),
    )

  const legacyOverflow = (hidden: number): string[] => {
    if (hidden <= 0) return []
    return [`  and ${hidden} more test${legacyPlural(hidden)}!`]
  }

  const legacyCoveredTests = (tests: readonly string[], render: ClearTextRenderOptions): string[] => {
    const logged = Math.min(render.maxTestsToLog, tests.length)
    if (logged <= 0) return []
    return [
      'Tests ran:',
      ...tests.slice(0, logged).map((test) => `    ${test}`),
      ...legacyOverflow(tests.length - render.maxTestsToLog),
      '',
    ]
  }

  const legacyMutantBlock = (
    fileName: string,
    mutant: ReportMutant,
    source: string | undefined,
    render: ClearTextRenderOptions,
  ): string[] => {
    const out: string[] = []
    out.push(`[${legacyMutantLabel(mutant.status, render.allowEmojis)}] ${mutant.mutatorName}`)
    out.push(legacySourceLocation(fileName, mutant.location.start, render.allowColor))
    out.push(...legacyOriginalLines(source, mutant.location.start, render.allowColor))
    out.push(...legacyReplacementLines(mutant.replacement, render.allowColor))
    out.push(...legacyStatusTail(mutant, render))
    out.push('')
    return out
  }

  const legacyLinesFor = (
    entries: readonly LegacyEntry[],
    channel: 'stdout' | 'debug',
    render: ClearTextRenderOptions,
  ): string[] => {
    const reported = entries.filter((entry) => LEGACY_CHANNEL[entry.mutant.status] === channel)
    return reported.flatMap((entry) => legacyMutantBlock(entry.fileName, entry.mutant, entry.source, render))
  }

  const legacyCollect = (report: reportApi.MutationTestResult, render: ClearTextRenderOptions) => {
    const entries = legacyExtract(report)
    return {
      stdout: legacyLinesFor(entries, 'stdout', render),
      debug: legacyLinesFor(entries, 'debug', render),
      totalTests: entries.reduce((total, entry) => total + (entry.mutant.testsCompleted ?? 0), 0),
    }
  }

  const legacyPartialVisible = (metrics: reportApi.MetricsResult, render: ClearTextRenderOptions): boolean => {
    if (!render.skipFull) return true
    return metrics.childResults.some((child) => child.metrics.mutationScore !== 100)
  }

  const legacyDrawsTable = (metrics: reportApi.MetricsResult, render: ClearTextRenderOptions): boolean => {
    if (!render.reportScoreTable) return false
    return legacyPartialVisible(metrics, render)
  }

  const legacyTestsPerMutant = (metrics: reportApi.MetricsResult, totalTests: number): string => {
    const total = metrics.metrics.totalMutants
    if (total === 0) return '0.00'
    return (totalTests / total).toFixed(2)
  }

  const legacyMutantSection = (
    report: reportApi.MutationTestResult,
    metrics: reportApi.MetricsResult,
    render: ClearTextRenderOptions,
  ): { stdout: string[]; debug: string[] } => {
    if (!render.reportMutants) return { stdout: [], debug: [] }
    const blocks = legacyCollect(report, render)
    return {
      stdout: [
        '',
        ...blocks.stdout,
        `Ran ${legacyTestsPerMutant(metrics, blocks.totalTests)} tests per mutant on average.`,
      ],
      debug: blocks.debug,
    }
  }

  const LEGACY_KNOWN_EMOJI: Record<string, true> = {
    '✅': true,
    '🙈': true,
    '🤥': true,
    '👽': true,
    '⏰': true,
    '⌛': true,
    '💥': true,
  }

  const legacyCharWidth = (char: string): number =>
    Match.value(char).pipe(
      Match.when((candidate) => LEGACY_KNOWN_EMOJI[candidate] === true, () => 2),
      Match.when((candidate) => (candidate.codePointAt(0) ?? 0) > 0xffff, () => 2),
      Match.orElse(() => 1),
    )

  const legacyStringWidth = (input: string): number =>
    Array.from(input).reduce((width, char) => width + legacyCharWidth(char), 0)

  const LEGACY_FILES_ROOT = 'All files'

  const legacyRepeat = (char: string, nTimes: number): string => {
    if (nTimes > -1) {
      return char.repeat(nTimes)
    }
    return char.repeat(0)
  }
  const legacySpaces = (n: number): string => legacyRepeat(' ', n)

  const legacyStatusHeader = (allowEmojis: boolean, emoji: string, label: string): string => {
    if (allowEmojis) {
      return `${emoji} ${label}`
    }
    return `# ${label}`
  }

  const legacyMaxOf = (values: readonly number[]): number =>
    values.reduce((acc, cur) => {
      if (cur > acc) {
        return cur
      }
      return acc
    }, Number.NEGATIVE_INFINITY)

  const legacyWidthOrZero = (width: number): number =>
    Match.value(width === Number.NEGATIVE_INFINITY).pipe(
      Match.when(true, () => 0),
      Match.when(false, () => width),
      Match.exhaustive,
    )

  type LegacyCellFactory = (row: reportApi.MetricsResult, ancestorCount: number) => string

  const legacyContentWidth = (
    row: reportApi.MetricsResult,
    valueFactory: LegacyCellFactory,
    ancestorCount: number,
  ): number => {
    const head = valueFactory(row, ancestorCount).length
    const childWidths = row.childResults.map((child) => legacyContentWidth(child, valueFactory, ancestorCount + 1))
    return legacyWidthOrZero(legacyMaxOf([head, ...childWidths]))
  }

  type LegacyColumn =
    | {
      readonly kind: 'single'
      readonly header: string
      readonly isFirstColumn: boolean
      readonly netWidth: number
      readonly valueFactory: LegacyCellFactory
      readonly rows: reportApi.MetricsResult
    }
    | {
      readonly kind: 'file'
      readonly header: string
      readonly isFirstColumn: true
      readonly netWidth: number
      readonly valueFactory: LegacyCellFactory
      readonly rows: reportApi.MetricsResult
    }
    | {
      readonly kind: 'mutationScore'
      readonly header: string
      readonly isFirstColumn: false
      readonly netWidth: number
      readonly valueFactory: LegacyCellFactory
      readonly rows: reportApi.MetricsResult
      readonly thresholds: reportApi.MutationScoreThresholds
      readonly scoreType: 'total' | 'covered'
      readonly allowColor: boolean
    }
    | {
      readonly kind: 'group'
      readonly header: string
      readonly isFirstColumn: boolean
      readonly netWidth: number
      readonly columns: readonly LegacyColumn[]
    }

  const legacyColumnWidth = (column: LegacyColumn): number => {
    if (column.isFirstColumn) {
      return column.netWidth + 1
    }
    return column.netWidth + 2
  }

  const legacyPad = (column: LegacyColumn, input: string): string =>
    Match.value(column.kind === 'file').pipe(
      Match.when(true, () => `${input}${legacySpaces(legacyColumnWidth(column) - legacyStringWidth(input))}`),
      Match.when(false, () =>
        Match.value(column.isFirstColumn).pipe(
          Match.when(true, () => `${legacySpaces(column.netWidth - legacyStringWidth(input))}${input} `),
          Match.when(false, () => `${legacySpaces(column.netWidth - legacyStringWidth(input))} ${input} `),
          Match.exhaustive,
        )),
      Match.exhaustive,
    )

  const legacyDrawLine = (column: LegacyColumn): string => legacyRepeat('-', legacyColumnWidth(column))

  const legacyDrawHeader = (column: LegacyColumn): string => legacyPad(column, column.header)

  type LegacyScoreColumn = Extract<LegacyColumn, { readonly kind: 'mutationScore' }>

  const legacyScoreOf = (
    scoreType: 'total' | 'covered',
    metrics: reportApi.MetricsResult['metrics'],
  ): number =>
    Match.value(scoreType).pipe(
      Match.when('total', () => metrics.mutationScore),
      Match.when('covered', () => metrics.mutationScoreBasedOnCoveredCode),
      Match.exhaustive,
    )

  const legacyThresholdColor = (
    thresholds: reportApi.MutationScoreThresholds,
    value: number,
  ): ((input: string) => string) =>
    Match.value(value).pipe(
      Match.when((present: number) => Number.isNaN(present), () => ansi.grey),
      Match.when((present) => present >= thresholds.high, () => ansi.green),
      Match.when((present) => present >= thresholds.low, () => ansi.yellow),
      Match.orElse(() => ansi.red),
    )

  const legacyScoreColor = (column: LegacyScoreColumn, score: reportApi.MetricsResult): ((input: string) => string) =>
    Match.value(column.allowColor).pipe(
      Match.when(true, () => legacyThresholdColor(column.thresholds, legacyScoreOf(column.scoreType, score.metrics))),
      Match.when(false, () => (input: string): string => input),
      Match.exhaustive,
    )

  const legacyColorFor = (column: LegacyColumn, score: reportApi.MetricsResult): ((input: string) => string) =>
    Match.value(column).pipe(
      Match.discriminator('kind')('mutationScore', (scored) => legacyScoreColor(scored, score)),
      Match.orElse(() => (input: string): string => input),
    )

  const legacyDrawCell = (column: LegacyColumn, score: reportApi.MetricsResult, ancestorCount: number): string => {
    switch (column.kind) {
      case 'group':
        return column.columns.map((c) => legacyDrawCell(c, score, ancestorCount)).join('|')
      case 'single':
      case 'file':
      case 'mutationScore': {
        const raw = column.valueFactory(score, ancestorCount)
        const padded = legacyPad(column, raw)
        return legacyColorFor(column, score)(padded)
      }
    }
  }

  const legacyDrawColumnHeaders = (column: LegacyColumn): string => {
    if (column.kind !== 'group') return legacyDrawHeader(column)
    return column.columns.map((c) => legacyDrawHeader(c)).join('|')
  }

  const legacyDrawColumnLines = (column: LegacyColumn): string => {
    if (column.kind !== 'group') return legacyDrawLine(column)
    return column.columns.map((c) => legacyDrawLine(c)).join('|')
  }

  const legacySingleColumn = (
    header: string,
    isFirstColumn: boolean,
    valueFactory: LegacyCellFactory,
    rows: reportApi.MetricsResult,
  ): LegacyColumn => {
    const maxContentSize = legacyContentWidth(rows, valueFactory)
    const netWidth = legacyMaxOf([maxContentSize, legacyStringWidth(header)])
    return {
      kind: 'single',
      header,
      isFirstColumn,
      netWidth: legacyWidthOrZero(netWidth),
      valueFactory,
      rows,
    }
  }

  const legacyFileColumn = (rows: reportApi.MetricsResult): LegacyColumn => {
    const valueFactory: LegacyCellFactory = (row, ancestorCount) => {
      if (ancestorCount === 0) {
        return legacySpaces(ancestorCount) + LEGACY_FILES_ROOT
      }
      return legacySpaces(ancestorCount) + row.name
    }
    const netWidth = legacyMaxOf([legacyContentWidth(rows, valueFactory), legacyStringWidth('File')])
    return {
      kind: 'file',
      header: 'File',
      isFirstColumn: true,
      netWidth: legacyWidthOrZero(netWidth),
      valueFactory,
      rows,
    }
  }

  const legacyScoreColumn = (
    rows: reportApi.MetricsResult,
    thresholds: reportApi.MutationScoreThresholds,
    scoreType: 'total' | 'covered',
    allowColor: boolean,
  ): LegacyColumn => {
    const valueFactory: LegacyCellFactory = (row) =>
      Match.value(legacyScoreOf(scoreType, row.metrics)).pipe(
        Match.when((present: number) => Number.isNaN(present), () => 'n/a'),
        Match.orElse((present) => present.toFixed(2)),
      )
    const netWidth = legacyMaxOf([legacyContentWidth(rows, valueFactory), legacyStringWidth(scoreType)])
    return {
      kind: 'mutationScore',
      header: scoreType,
      isFirstColumn: false,
      netWidth: legacyWidthOrZero(netWidth),
      valueFactory,
      rows,
      thresholds,
      scoreType,
      allowColor,
    }
  }

  const legacyPaddingWidth = (isFirstColumn: boolean): number =>
    Match.value(isFirstColumn).pipe(
      Match.when(true, () => 1),
      Match.when(false, () => 2),
      Match.exhaustive,
    )

  const legacyWidthAdjusted = (
    columns: readonly LegacyColumn[],
    first: LegacyColumn,
    columnsWidth: number,
    netWidth: number,
  ): readonly LegacyColumn[] =>
    Match.value(netWidth > columnsWidth + 1).pipe(
      Match.when(true, () => [
        { ...first, netWidth: first.netWidth + (netWidth - columnsWidth - 1) },
        ...columns.slice(1),
      ]),
      Match.when(false, () => columns),
      Match.exhaustive,
    )

  const legacyGroupColumn = (groupName: string, columns: readonly LegacyColumn[]): LegacyColumn => {
    const [first, ...rest] = columns
    if (first === undefined) throw new globalThis.Error('a group column needs at least one column')
    const columnsWidth = rest.reduce((acc, cur) => acc + legacyColumnWidth(cur), legacyColumnWidth(first)) -
      legacyPaddingWidth(first.isFirstColumn)
    const netWidth = legacyWidthOrZero(legacyMaxOf([legacyStringWidth(groupName), columnsWidth]))
    return {
      kind: 'group',
      header: groupName,
      isFirstColumn: first.isFirstColumn,
      netWidth,
      columns: legacyWidthAdjusted(columns, first, columnsWidth, netWidth),
    }
  }

  const legacyCreateColumns = (
    metricsResult: reportApi.MetricsResult,
    render: ClearTextRenderOptions,
  ): readonly LegacyColumn[] => [
    legacyGroupColumn('', [legacyFileColumn(metricsResult)]),
    legacyGroupColumn('% Mutation score', [
      legacyScoreColumn(metricsResult, render.thresholds, 'total', render.allowColor),
      legacyScoreColumn(metricsResult, render.thresholds, 'covered', render.allowColor),
    ]),
    legacyGroupColumn('', [
      legacySingleColumn(
        legacyStatusHeader(render.allowEmojis, '✅', 'killed'),
        false,
        (row) => row.metrics.killed.toString(),
        metricsResult,
      ),
    ]),
    legacyGroupColumn('', [
      legacySingleColumn(
        legacyStatusHeader(render.allowEmojis, '⌛️', 'timeout'),
        false,
        (row) => row.metrics.timeout.toString(),
        metricsResult,
      ),
    ]),
    legacyGroupColumn('', [
      legacySingleColumn(
        legacyStatusHeader(render.allowEmojis, '👽', 'survived'),
        false,
        (row) => row.metrics.survived.toString(),
        metricsResult,
      ),
    ]),
    legacyGroupColumn('', [
      legacySingleColumn(
        legacyStatusHeader(render.allowEmojis, '🙈', 'no cov'),
        false,
        (row) => row.metrics.noCoverage.toString(),
        metricsResult,
      ),
    ]),
    legacyGroupColumn('', [
      legacySingleColumn(
        legacyStatusHeader(render.allowEmojis, '💥', 'errors'),
        false,
        (row) => (row.metrics.runtimeErrors + row.metrics.compileErrors).toString(),
        metricsResult,
      ),
    ]),
  ]

  const legacyDrawRow = (columns: readonly LegacyColumn[], toDraw: (col: LegacyColumn) => string): string =>
    `${columns.map(toDraw).join('|')}|`

  const legacyTableBody = (
    columns: readonly LegacyColumn[],
    render: ClearTextRenderOptions,
    current: reportApi.MetricsResult,
    ancestorCount: number,
  ): string[] => {
    const ownRow = Match.value(render.skipFull === false || current.metrics.mutationScore !== 100).pipe(
      Match.when(true, () => [legacyDrawRow(columns, (column) => legacyDrawCell(column, current, ancestorCount))]),
      Match.when(false, (): string[] => []),
      Match.exhaustive,
    )
    const childRows = current.childResults.flatMap((child) =>
      legacyTableBody(columns, render, child, ancestorCount + 1))
    return [...ownRow, ...childRows]
  }

  const LEGACY_EOL = '\n'

  const legacyScoreTable = (metricsResult: reportApi.MetricsResult, render: ClearTextRenderOptions): string => {
    const columns = legacyCreateColumns(metricsResult, render)
    return [
      legacyDrawRow(columns, legacyDrawLine),
      legacyDrawRow(columns, legacyDrawHeader),
      legacyDrawRow(columns, legacyDrawColumnHeaders),
      legacyDrawRow(columns, legacyDrawColumnLines),
      legacyTableBody(columns, render, metricsResult, 0).join(LEGACY_EOL),
      legacyDrawRow(columns, legacyDrawColumnLines),
    ].join(LEGACY_EOL)
  }

  const legacyRenderClearText = (
    report: reportApi.MutationTestResult,
    metrics: reportApi.MetricsResult,
    render: ClearTextRenderOptions,
  ): { stdout: string[]; debug: string[] } => {
    const section = legacyMutantSection(report, metrics, render)
    const table = legacyDrawsTable(metrics, render) ? legacyScoreTable(metrics, render) : undefined
    return {
      stdout: ['', ...section.stdout, ...(table === undefined ? [] : [table])],
      debug: [...section.debug],
    }
  }

  const { ClearTextRenderOptions } = await import('./render-clear-text-report.workflow.js')
  const { MutationTestResultSchema } = await import('@systemfsoftware/stryker-js-plugin-interface')

  const reportArb = Arbitrary.schema(MutationTestResultSchema)

  const renderArb = Arbitrary.schema(ClearTextRenderOptions)

  const sameChunks = (left: readonly string[], right: readonly string[]): boolean =>
    left.length === right.length && left.every((chunk, index) => chunk === right[index])

  const spanToneArb = Arbitrary.schema(Schema.Literals([
    'plain',
    'identifier',
    'emphasis',
    'positive',
    'warning',
    'negative',
    'muted',
  ]))

  const renderedOf = (report: reportApi.MutationTestResult, render: ClearTextRenderOptions) =>
    Result.match(
      renderClearTextReport(
        ClearTextReportCommand.make({
          reported: report,
          computed: calculateMetrics(report.files),
          render,
          rendered: true,
        }),
      ),
      {
        onFailure: () => Option.none(),
        onSuccess: (value) =>
          Match.value(value).pipe(
            Match.tag('ClearTextReportRendered', (rendered) => Option.some(rendered)),
            Match.orElse(() => Option.none()),
          ),
      },
    )

  it.prop('∀report_NewBytes_≡LegacyBytes', [reportArb, renderArb], ([report, render]) =>
    Option.match(renderedOf(report, render), {
      onNone: () => false,
      onSome: (rendered) => {
        const legacy = legacyRenderClearText(report, calculateMetrics(report.files), render)
        const newStdout = rendered.stdout.map((chunk) => renderChunk(chunk))
        const newDebug = rendered.diagnostics.map((chunk) => renderChunk(chunk))
        if (!sameChunks(newStdout, legacy.stdout)) {
          newStdout.forEach((line, index) =>
            console.log('STDOUT', index, JSON.stringify(legacy.stdout[index]), '|', JSON.stringify(line)))
        }
        if (!sameChunks(newDebug, legacy.debug)) {
          newDebug.forEach((line, index) =>
            console.log('DEBUG', index, JSON.stringify(legacy.debug[index]), '|', JSON.stringify(line)))
        }
        return sameChunks(newStdout, legacy.stdout) && sameChunks(newDebug, legacy.debug)
      },
    }))

  const spanTextArb = Arbitrary.schema(Schema.String.check(Schema.isMaxLength(8)))

  it.prop('∀ab_MergedSpans_≡SplitBytes', [spanTextArb, spanTextArb, spanToneArb], ([a, b, tone]) => {
    const span = (text: string): ReportSpan => ({
      _tag: 'ReportSpan',
      text,
      tone,
      leftPad: 0,
      rightPad: 0,
      repeat: 1,
    })
    return renderChunk([[span(`${a}${b}`)]]) === renderChunk([[span(a), span(b)]])
  })
}
