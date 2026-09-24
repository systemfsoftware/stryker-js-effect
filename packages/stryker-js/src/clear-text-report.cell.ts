import { Cell, Sandwich } from '@systemfsoftware/effect-cell-types'
import { ErrorText } from '@systemfsoftware/stryker-js-instrumenter'
import type * as reportApi from '@systemfsoftware/stryker-js-plugin-interface'
import type { ReporterEvent, ReporterFactory, StrykerOptions } from '@systemfsoftware/stryker-js-plugin-interface'
import { ReporterFailed } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Arr from 'effect/Array'
import * as Boolean from 'effect/Boolean'
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
  ClearTextReportCommand,
  renderClearTextReport,
  type ReportChunk,
  type ReportLine,
  type ReportSpan,
  type Tone,
} from './render-clear-text-report.workflow.js'
import { ReporterOutput, type ReporterOutputShape } from './reporter-output.service.js'
import { AnsiCode, type AnsiColor } from './reporting/ansi.schema.js'

const failAsClearText = <E = unknown>(cause: E): ReporterFailed =>
  ReporterFailed.make({
    reporterName: 'clear-text',
    event: 'mutationTestReportReady',
    cause: Option.getOrElse(Option.map(ErrorText.fromCause(cause), (rendered) => rendered.text), () => ''),
  })

interface TerminalReport {
  readonly report: reportApi.MutationTestResult
  readonly metrics: reportApi.MetricsResult
}

const terminalReportOf = Filter.make((event: ReporterEvent): Result.Result<TerminalReport, 'not-terminal'> =>
  Match.value(event).pipe(
    Match.tag('mutationTestReportReady', (ready) => Result.succeed({ report: ready.report, metrics: ready.metrics })),
    Match.orElse(() => Result.fail('not-terminal' as const)),
  )
)

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

const tint = (color: AnsiColor, text: string) =>
  `${AnsiCode.fields[color].literal}${text}${AnsiCode.fields.reset.literal}`

const TINT_BY_TONE: Record<Tone, (text: string) => string> = {
  'plain': (text) => text,
  'identifier': (text) => tint('cyan', text),
  'emphasis': (text) => tint('yellow', text),
  'positive': (text) => tint('green', text),
  'warning': (text) => tint('yellow', text),
  'negative': (text) => tint('red', text),
  'muted': (text) => tint('grey', text),
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

type ReporterCellServices<C> = C extends Cell.Cell<infer _I, infer _A, infer _E, infer S> ? S : never

export const clearTextReporterFactory = (
  context: Context.Context<ReporterCellServices<typeof clearTextReportCell>>,
): ReporterFactory => {
  const report = Cell.provideContext(clearTextReportCell, context)
  return (options) => (events) => Effect.asVoid(report.run({ options, events }))
}

if (import.meta.vitest !== void 0) {
  const { it } = await import('@effect/vitest')
  const Schema = await import('effect/Schema')
  const Arbitrary = await import('effect/unstable/arbitrary/Arbitrary')
  const { ClearTextRenderOptions } = await import('./render-clear-text-report.workflow.js')

  const ANSI_ESCAPE = '\u001b'

  const commandArb = Arbitrary.schema(ClearTextReportCommand)

  const renderArb = Arbitrary.schema(ClearTextRenderOptions)

  const colorOffArb = commandArb.pipe(
    Arbitrary.map((command) =>
      ClearTextReportCommand.make({
        reported: command.reported,
        computed: command.computed,
        render: { ...command.render, allowColor: false },
        rendered: command.rendered,
      })
    ),
  )

  const suppressedArb = renderArb.pipe(
    Arbitrary.map((render) =>
      ClearTextReportCommand.make({ reported: undefined, computed: undefined, render, rendered: true })
    ),
  )

  const outputBytesOf = (command: ClearTextReportCommand): readonly string[] =>
    Result.match(renderClearTextReport(command), {
      onFailure: () => [],
      onSuccess: (value) =>
        Match.value(value).pipe(
          Match.tag('ClearTextReportRendered', (rendered) => [
            ...rendered.stdout.map(renderChunk),
            ...rendered.diagnostics.map(renderChunk),
          ]),
          Match.tag('ClearTextReportSuppressed', () => []),
          Match.exhaustive,
        ),
    })

  it.prop('∀c_NoTerminalReport_≡NoOutputBytes', [suppressedArb], ([command]) => outputBytesOf(command).length === 0)

  it.prop(
    '∀c_ColorOff_≡EscapeFreeBytes',
    [colorOffArb],
    ([command]) => outputBytesOf(command).every((bytes) => !bytes.includes(ANSI_ESCAPE)),
  )

  const spanToneArb = Arbitrary.schema(Schema.Literals([
    'plain',
    'identifier',
    'emphasis',
    'positive',
    'warning',
    'negative',
    'muted',
  ]))

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
