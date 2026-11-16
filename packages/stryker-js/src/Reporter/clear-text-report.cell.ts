import { Sandwich } from '@systemfsoftware/effect-cell-types'
import { SpanTaxonomy } from '@systemfsoftware/stryker-js-cli-contract'
import { type Options, type Report, Reporter } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Effect from 'effect/Effect'
import * as Filter from 'effect/Filter'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as Sink from 'effect/Sink'
import * as Stream from 'effect/Stream'

import { ClearTextReportCommand } from './clear-text-report.schema.js'
import type { ClearTextRenderOptions } from './render-clear-text-report.js'
import { failAsReporter } from './reporter-failed.js'
import { ReporterOutput } from './reporter-output.service.js'
import { HumanStreamRole } from './reporter-role.schema.js'
import { clearTextOutputOf } from './summarize-clear-text-report.js'

const failAsClearText = failAsReporter(HumanStreamRole.literal)

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
      debug: input.options.logLevel === 'debug',
      render: renderOptionsOf(input.options),
    }),
  )

const writeClearTextReport = Effect.fn(SpanTaxonomy.Spans.reportClearTextWrite.name)(
  function*(rendered: {
    readonly stdout: readonly string[]
    readonly stderr: readonly string[]
  }) {
    const output = yield* ReporterOutput
    yield* Effect.mapError(output.write('stdout', rendered.stdout), failAsClearText)
    yield* Effect.mapError(output.write('stderr', rendered.stderr), failAsClearText)
  },
)

export const clearTextReportCell = Sandwich.writer(SpanTaxonomy.Spans.reportClearText.name)(readClearTextReport)
  .decode(ClearTextReportCommand)
  .write({
    Decoded: (command, raw) => writeClearTextReport(clearTextOutputOf({ command, render: raw.render })),
    CommandRejected: ({ issue }) => Effect.fail(failAsClearText(issue)),
  })
