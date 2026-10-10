import { Sandwich } from '@systemfsoftware/effect-cell-types'
import { SpanTaxonomy } from '@systemfsoftware/stryker-js-cli-contract'
import { type Options, type Report, Reporter } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Arr from 'effect/Array'
import * as Effect from 'effect/Effect'
import * as Filter from 'effect/Filter'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as Sink from 'effect/Sink'
import * as Stream from 'effect/Stream'

import { Reports } from '@systemfsoftware/stryker-js-contracts'
import {
  type ClearTextRenderOptions,
  renderClearTextReport,
  type ReportChunk,
  type ReportLine,
  type ReportSpan,
  type Tone,
} from './render-clear-text-report.workflow.js'
import { failAsClearText } from './reporter-failures.js'

interface TerminalReport {
  readonly report: Report.MutationTestResult
  readonly metrics: Report.MetricsResult
  readonly static: Report.StaticClassSummary | undefined
}

const terminalReportOf = Filter.make((event: Reporter.ReporterEvent): Result.Result<TerminalReport, 'not-terminal'> =>
  Match.value(event).pipe(
    Match.tag(
      'mutationTestReportReady',
      (ready) => Result.succeed({ report: ready.report, metrics: ready.metrics, static: ready.static }),
    ),
    Match.orElse(() => Result.fail('not-terminal' as const)),
  )
)

const renderOptionsOf = (options: Options.StrykerOptions): ClearTextRenderOptions => ({
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
  readonly options: Options.StrykerOptions
  readonly events: AsyncIterable<Reporter.ReporterEvent>
}) =>
  Effect.map(
    Stream.fromAsyncIterable(input.events, failAsClearText).pipe(
      Stream.filterMap(terminalReportOf),
      Stream.run(Sink.last<TerminalReport>()),
    ),
    (terminal) => ({
      _tag: 'ClearTextReportCommand' as const,
      reported: Option.getOrUndefined(Option.map(terminal, (ready) => ready.report)),
      computed: Option.getOrUndefined(Option.map(terminal, (ready) => ready.metrics)),
      static: Option.getOrUndefined(Option.flatMap(terminal, (ready) => Option.fromUndefinedOr(ready.static))),
      render: renderOptionsOf(input.options),
      rendered: true,
    }),
  )

const tint = (color: Reports.AnsiColor, text: string): string =>
  `${Reports.AnsiCode.fields[color].literal}${text}${Reports.AnsiCode.fields.reset.literal}`

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

const writeChunks = (
  output: Reports.ReporterOutputShape,
  channel: Reports.OutputChannel,
  chunks: ReadonlyArray<ReportChunk>,
): Effect.Effect<void, Reporter.ReporterFailed> =>
  Effect.mapError(output.write(channel, chunks.map(renderChunk)), failAsClearText)

const writeClearTextReport = Effect.fn(SpanTaxonomy.Spans.reportClearTextWrite.name)(
  function*(rendered: {
    readonly stdout: ReadonlyArray<ReportChunk>
    readonly stderr: ReadonlyArray<ReportChunk>
  }) {
    const output = yield* Reports.ReporterOutput
    yield* writeChunks(output, 'stdout', rendered.stdout)
    yield* writeChunks(output, 'stderr', rendered.stderr)
  },
)

export const clearTextReportCell = Sandwich.named(SpanTaxonomy.Spans.reportClearText.name)(readClearTextReport)
  .decide(renderClearTextReport)
  .write({
    ClearTextReportRendered: (rendered) => writeClearTextReport(rendered),
    ClearTextReportSuppressed: () => Effect.void,
    CommandRejected: ({ issue }) => Effect.fail(failAsClearText(issue)),
  })
