import { Cell, Sandwich } from '@systemfsoftware/effect-cell-types'
import { errorToString } from '@systemfsoftware/stryker-js-instrumenter'
import type * as reportApi from '@systemfsoftware/stryker-js-plugin-interface'
import type { ReporterEvent, ReporterFactory, StrykerOptions } from '@systemfsoftware/stryker-js-plugin-interface'
import { ReporterFailed } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Boolean from 'effect/Boolean'
import type * as Context from 'effect/Context'
import * as Effect from 'effect/Effect'
import * as Filter from 'effect/Filter'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as Sink from 'effect/Sink'
import * as Stream from 'effect/Stream'

import { ReporterOutput } from './reporter-output.service.js'
import {
  renderClearTextReport,
  type ClearTextRenderOptions,
} from './render-clear-text-report.workflow.js'

const failAsClearText = (cause: string) =>
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

export const clearTextReportCell = Sandwich.named('stryker.report.clearText')(readClearTextReport)
  .decide(renderClearTextReport)
  .write({
    ClearTextReportRendered: (rendered, raw) =>
      Effect.gen(function*() {
        const output = yield* ReporterOutput
        yield* output.write('stdout', rendered.stdout.map((line) => `${line}\n`)).pipe(
          Effect.mapError(failAsClearText),
          Effect.asVoid,
        )
        yield* Boolean.match(raw.render.debug, {
          onTrue: () =>
            output.write('stderr', rendered.diagnostics.map((line) => `${line}\n`)).pipe(
              Effect.mapError(failAsClearText),
              Effect.asVoid,
            ),
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
