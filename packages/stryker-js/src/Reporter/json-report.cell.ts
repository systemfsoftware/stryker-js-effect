import { Sandwich } from '@systemfsoftware/effect-cell-types'
import { SpanTaxonomy } from '@systemfsoftware/stryker-js-cli-contract'
import { type Options, Report, Reporter } from '@systemfsoftware/stryker-js-plugin-interface'
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

import { JsonReportCommand } from './json-report.schema.js'
import { renderDebugNotices, renderReportLocationNotice } from './render-json-report.js'
import { failAsReporter } from './reporter-failed.js'
import { JsonReporterName } from './reporter-name.js'
import { ReporterOutput } from './reporter-output.service.js'

const failAsJsonReporter = failAsReporter(JsonReporterName)

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
      reports: Option.toArray(last),
      debug: input.options.logLevel === 'debug',
      fileName: input.options.jsonReporter.fileName,
    }),
  )

const jsonBytesOf = (report: Report.MutationTestResult): Effect.Effect<string, Reporter.ReporterFailed> =>
  S.encodeEffect(S.fromJsonString(Report.MutationTestResult, { space: 0 }))(report).pipe(
    Effect.mapError(failAsJsonReporter),
  )

const writeJsonReport = Effect.fn(SpanTaxonomy.Spans.reportJsonWrite.name)(function*(
  report: Report.MutationTestResult,
  command: { readonly debug: boolean; readonly fileName: string },
) {
  const output = yield* ReporterOutput
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const json = yield* jsonBytesOf(report)
  const fileName = path.resolve(command.fileName)
  yield* Effect.ignore(
    output.write(
      'stderr',
      renderDebugNotices({ debug: command.debug, normalizedFileName: path.normalize(command.fileName) }),
    ),
  )
  yield* fs.makeDirectory(path.dirname(fileName), { recursive: true }).pipe(Effect.mapError(failAsJsonReporter))
  yield* fs.writeFileString(fileName, json).pipe(Effect.mapError(failAsJsonReporter))
  const url = yield* path.toFileUrl(fileName).pipe(Effect.mapError(failAsJsonReporter))
  yield* Effect.ignore(output.write('stderr', [renderReportLocationNotice(url.href)]))
})

export const jsonReportCell = Sandwich.writer(SpanTaxonomy.Spans.reportJson.name)(readJsonReport)
  .decode(JsonReportCommand)
  .write({
    Decoded: (command) =>
      Effect.forEach(command.reports, (report) => writeJsonReport(report, command), { discard: true }),
    CommandRejected: ({ issue }) => Effect.fail(failAsJsonReporter(issue)),
  })
