import { Cell } from '@systemfsoftware/effect-cell-types'
import { SpanTaxonomy } from '@systemfsoftware/stryker-js-cli-contract'
import { ErrorText } from '@systemfsoftware/stryker-js-instrumenter'
import { type Options, type Report, Reporter } from '@systemfsoftware/stryker-js-plugin-interface'
import type * as Context from 'effect/Context'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as Filter from 'effect/Filter'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Path from 'effect/Path'
import * as Ref from 'effect/Ref'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import * as Sink from 'effect/Sink'
import * as Stream from 'effect/Stream'

import { clearTextReportCell } from './clear-text-report.cell.js'
import { jsonReportCell } from './json-report.cell.js'
import { progressReportCell } from './progress-report.cell.js'
import type { ProgressState, ProgressTally } from './render-progress-report.workflow.js'
import { failAsProgress } from './reporter-failures.js'
import { ReporterOutput } from './reporter-output.service.js'
import { sarifReport, SarifReportCommand } from './sarif-report.workflow.js'
import { sarifFileNameOf } from './stryker-outputs.js'
import { surfacedSurvivorsOf } from './surfacing.js'

type ReporterCellServices<C> = C extends Cell.Cell<infer _I, infer _A, infer _E, infer S> ? S : never

const emptyTally = (startedAt: number): ProgressTally => ({
  survived: 0,
  timedOut: 0,
  tested: 0,
  mutants: 0,
  total: 0,
  ticks: 0,
  ticksByMutantId: {},
  timing: { net: 0, overhead: 0 },
  capabilities: { reloadEnvironment: false },
  startedAt,
})

const INITIAL_PROGRESS: ProgressState = { tally: emptyTally(0), bar: null }

export const clearTextReporterFactory = (
  context: Context.Context<ReporterCellServices<typeof clearTextReportCell>>,
): Reporter.ReporterFactory => {
  const report = Cell.provideContext(clearTextReportCell, context)
  return (options) => (events) => Effect.asVoid(report.run({ options, events }))
}

export const jsonReporterFactory = (
  context: Context.Context<ReporterCellServices<typeof jsonReportCell>>,
): Reporter.ReporterFactory => {
  const report = Cell.provideContext(jsonReportCell, context)
  return (options) => (events) => Effect.asVoid(report.run({ options, events }))
}

export const progressReporterFactory = (
  context: Context.Context<ReporterCellServices<typeof progressReportCell>>,
): Reporter.ReporterFactory => {
  const step = Cell.provideContext(progressReportCell, context)
  const consumeEvent = Effect.fn(SpanTaxonomy.Spans.reportProgressConsumeEvent.name)(function*(
    state: Ref.Ref<ProgressState>,
    event: Reporter.ReporterEvent,
  ) {
    const current = yield* Ref.get(state)
    const next = yield* step.run({ state: current, event })
    yield* Ref.set(state, next)
  })
  return () =>
    Effect.fn(SpanTaxonomy.Spans.reportProgressConsume.name)(function*(
      events: AsyncIterable<Reporter.ReporterEvent>,
    ) {
      const state = yield* Ref.make<ProgressState>(INITIAL_PROGRESS)
      yield* Stream.runForEach(
        Stream.fromAsyncIterable(events, failAsProgress),
        (event) => consumeEvent(state, event),
      )
      yield* step.run({ state: yield* Ref.get(state), event: undefined })
    })
}

const SARIF_MAX_RESULTS = 5000
const STRYKER_INFORMATION_URI = 'https://stryker-mutator.io'

const failAsSarif = <E = unknown>(cause: E): Reporter.ReporterFailed =>
  Reporter.ReporterFailed.make({
    reporterName: 'sarif',
    event: 'mutationTestReportReady',
    cause: Option.getOrElse(Option.map(ErrorText.errorTextOf(cause), (rendered) => rendered.text), () => ''),
  })

const reportOf = Filter.make((
  event: Reporter.ReporterEvent,
): Result.Result<Report.MutationTestResult, 'not-ready'> =>
  Match.value(event).pipe(
    Match.tag('mutationTestReportReady', (ready) => Result.succeed(ready.report)),
    Match.orElse(() => Result.fail('not-ready' as const)),
  )
)

const readSarifReport = (events: AsyncIterable<Reporter.ReporterEvent>) =>
  Effect.map(
    Stream.fromAsyncIterable(events, failAsSarif).pipe(
      Stream.filterMap(reportOf),
      Stream.run(Sink.last<Report.MutationTestResult>()),
    ),
    (last) => Option.getOrUndefined(last),
  )

const toolVersionOf = (report: Report.MutationTestResult): string =>
  Option.match(Option.fromNullishOr(report.framework), {
    onNone: () => '',
    onSome: (framework) => framework.version ?? '',
  })

const writeSarifReport = (options: Options.StrykerOptions, report: Report.MutationTestResult) =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const rendered = Result.getOrThrow(
      sarifReport(
        SarifReportCommand.make({
          report,
          survivors: surfacedSurvivorsOf(report, {
            perLine: options.surfacing.perLine,
            perFile: options.surfacing.perFile,
          }),
          tool: {
            name: 'StrykerJS',
            version: toolVersionOf(report),
            informationUri: STRYKER_INFORMATION_URI,
          },
          maxResults: SARIF_MAX_RESULTS,
        }),
      ),
    )
    const json = yield* S.encodeEffect(S.fromJsonString(S.Unknown, { space: 2 }))(rendered.log)
    const fileName = path.resolve(sarifFileNameOf(options.jsonReporter.fileName))
    yield* fs.makeDirectory(path.dirname(fileName), { recursive: true })
    yield* fs.writeFileString(fileName, json)
  }).pipe(Effect.mapError(failAsSarif))

export const sarifReporterFactory = (
  context: Context.Context<ReporterOutput | FileSystem.FileSystem | Path.Path>,
): Reporter.ReporterFactory =>
(options) =>
(events) =>
  Effect.provideContext(
    Effect.flatMap(readSarifReport(events), (report) =>
      Option.match(Option.fromUndefinedOr(report), {
        onNone: () => Effect.void,
        onSome: (present) => writeSarifReport(options, present),
      })),
    context,
  )
