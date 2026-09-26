import { Cell, Sandwich } from '@systemfsoftware/effect-cell-types'
import { ErrorText } from '@systemfsoftware/stryker-js-instrumenter'
import { type Options, type Report, Reporter } from '@systemfsoftware/stryker-js-plugin-interface'
import type * as Context from 'effect/Context'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as Filter from 'effect/Filter'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Path from 'effect/Path'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import * as Sink from 'effect/Sink'
import * as Stream from 'effect/Stream'

import { renderJsonReport } from './render-json-report.workflow.js'
import { ReporterOutput } from './reporter-output.service.js'

const failAsJsonReporter = <E = unknown>(cause: E): Reporter.ReporterFailed =>
  Reporter.ReporterFailed.make({
    reporterName: 'json',
    event: 'mutationTestReportReady',
    cause: Option.getOrElse(Option.map(ErrorText.ErrorText.fromCause(cause), (rendered) => rendered.text), () => ''),
  })

const reportOf = Filter.make((
  event: Reporter.ReporterEvent,
): Result.Result<Report.MutationTestResult, 'not-ready'> =>
  Match.value(event).pipe(
    Match.tag('mutationTestReportReady', (ready) => Result.succeed(ready.report)),
    Match.orElse(() => Result.fail('not-ready' as const)),
  )
)

const readJsonReport = (input: {
  readonly options: Options.StrykerOptions
  readonly events: AsyncIterable<Reporter.ReporterEvent>
}) =>
  Effect.map(
    Stream.fromAsyncIterable(input.events, failAsJsonReporter).pipe(
      Stream.filterMap(reportOf),
      Stream.run(Sink.last<Report.MutationTestResult>()),
    ),
    (last) => ({
      _tag: 'JsonReportCommand' as const,
      reported: Option.getOrUndefined(last),
      rendered: true,
      debug: input.options.logLevel === 'debug',
      fileName: input.options.jsonReporter.fileName,
      options: input.options,
    }),
  )

const jsonBytesOf = (report: Report.MutationTestResult): Effect.Effect<string, Reporter.ReporterFailed> =>
  S.encodeEffect(S.fromJsonString(S.Unknown, { space: 0 }))(report).pipe(
    Effect.mapError(failAsJsonReporter),
  )

const writeJsonReport = Effect.fn('stryker.report.json.write')(function*(
  rendered: {
    readonly report: Report.MutationTestResult
    readonly announceFileName: Option.Option<string>
  },
  raw: { readonly options: Options.StrykerOptions },
) {
  const output = yield* ReporterOutput
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const json = yield* jsonBytesOf(rendered.report)
  const fileName = path.resolve(raw.options.jsonReporter.fileName)
  yield* Effect.forEach(
    Option.toArray(rendered.announceFileName),
    (name) => Effect.ignore(output.write('stderr', [`Using relative path ${path.normalize(name)}\n`])),
    { discard: true },
  )
  yield* fs.makeDirectory(path.dirname(fileName), { recursive: true }).pipe(Effect.mapError(failAsJsonReporter))
  yield* fs.writeFileString(fileName, json).pipe(Effect.mapError(failAsJsonReporter))
  const url = yield* path.toFileUrl(fileName).pipe(Effect.mapError(failAsJsonReporter))
  yield* Effect.ignore(output.write('stdout', [`Your report can be found at: ${url.href}\n`]))
})

export const jsonReportCell = Sandwich.named('stryker.report.json')(readJsonReport)
  .decide(renderJsonReport)
  .write({
    JsonReportRendered: (rendered, raw) => writeJsonReport(rendered, raw),
    JsonReportSuppressed: () => Effect.void,
    CommandRejected: ({ issue }) => Effect.fail(failAsJsonReporter(issue)),
  })

type ReporterCellServices<C> = C extends Cell.Cell<infer _I, infer _A, infer _E, infer S> ? S : never

export const jsonReporterFactory = (
  context: Context.Context<ReporterCellServices<typeof jsonReportCell>>,
): Reporter.ReporterFactory => {
  const report = Cell.provideContext(jsonReportCell, context)
  return (options) => (events) => Effect.asVoid(report.run({ options, events }))
}
