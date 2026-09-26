import { Cell, Sandwich } from '@systemfsoftware/effect-cell-types'
import { ErrorText } from '@systemfsoftware/stryker-js-instrumenter'
import { type Options, type Report, Reporter } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Arr from 'effect/Array'
import type * as Context from 'effect/Context'
import * as Effect from 'effect/Effect'
import * as Filter from 'effect/Filter'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as Sink from 'effect/Sink'
import * as Stream from 'effect/Stream'

import {
  type ClearTextRenderOptions,
  renderClearTextReport,
  type ReportChunk,
  type ReportLine,
  type ReportSpan,
  type Tone,
} from './render-clear-text-report.workflow.js'
import { type OutputChannel, ReporterOutput, type ReporterOutputShape } from './reporter-output.service.js'
import { AnsiCode, type AnsiColor } from './reporting/ansi.schema.js'

const failAsClearText = <E = unknown>(cause: E): Reporter.ReporterFailed =>
  Reporter.ReporterFailed.make({
    reporterName: 'clear-text',
    event: 'mutationTestReportReady',
    cause: Option.getOrElse(Option.map(ErrorText.ErrorText.fromCause(cause), (rendered) => rendered.text), () => ''),
  })

interface TerminalReport {
  readonly report: Report.MutationTestResult
  readonly metrics: Report.MetricsResult
}

const terminalReportOf = Filter.make((event: Reporter.ReporterEvent): Result.Result<TerminalReport, 'not-terminal'> =>
  Match.value(event).pipe(
    Match.tag('mutationTestReportReady', (ready) => Result.succeed({ report: ready.report, metrics: ready.metrics })),
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
      render: renderOptionsOf(input.options),
      rendered: true,
    }),
  )

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

const writeChunks = (
  output: ReporterOutputShape,
  channel: OutputChannel,
  chunks: ReadonlyArray<ReportChunk>,
): Effect.Effect<void, Reporter.ReporterFailed> =>
  Effect.mapError(output.write(channel, chunks.map(renderChunk)), failAsClearText)

export const clearTextReportCell = Sandwich.named('stryker.report.clearText')(readClearTextReport)
  .decide(renderClearTextReport)
  .write({
    ClearTextReportRendered: (rendered) =>
      Effect.gen(function*() {
        const output = yield* ReporterOutput
        yield* writeChunks(output, 'stdout', rendered.stdout)
        yield* writeChunks(output, 'stderr', rendered.stderr)
      }),
    ClearTextReportSuppressed: () => Effect.void,
    CommandRejected: ({ issue }) => Effect.fail(failAsClearText(issue)),
  })

type ReporterCellServices<C> = C extends Cell.Cell<infer _I, infer _A, infer _E, infer S> ? S : never

export const clearTextReporterFactory = (
  context: Context.Context<ReporterCellServices<typeof clearTextReportCell>>,
): Reporter.ReporterFactory => {
  const report = Cell.provideContext(clearTextReportCell, context)
  return (options) => (events) => Effect.asVoid(report.run({ options, events }))
}
