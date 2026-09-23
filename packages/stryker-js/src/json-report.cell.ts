import { Cell, Sandwich } from '@systemfsoftware/effect-cell-types'
import type * as reportApi from '@systemfsoftware/stryker-js-plugin-interface'
import type { ReporterEvent, ReporterFactory, StrykerOptions } from '@systemfsoftware/stryker-js-plugin-interface'
import { ReporterFailed } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Boolean from 'effect/Boolean'
import type * as Context from 'effect/Context'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as Filter from 'effect/Filter'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Path from 'effect/Path'
import * as Result from 'effect/Result'
import * as Sink from 'effect/Sink'
import * as Stream from 'effect/Stream'

import { ReporterOutput } from './reporter-output.service.js'
import {
  failAsJsonReporter,
  JsonReportCommand,
  JsonReportRefused,
  JsonReportSuppressed,
  renderJsonReport,
} from './render-json-report.workflow.js'

const failAsJsonReporter = (cause: unknown) =>
  ReporterFailed.make({
    reporterName: 'json',
    event: 'mutationTestReportReady',
    cause: errorToString(cause),
  })

const reportOf = Filter.make((event: ReporterEvent): Result.Result<reportApi.MutationTestResult, unknown> =>
  Match.value(event).pipe(
    Match.tag('mutationTestReportReady', (ready) => Result.succeed(ready.report)),
    Match.orElse(() => Result.fail(undefined)),
  ))

type JsonReportRaw = (typeof JsonReportCommand)['Encoded'] & {
  readonly options: StrykerOptions
}

const readJsonReport = (input: {
  readonly options: StrykerOptions
  readonly events: AsyncIterable<ReporterEvent>
}): Effect.Effect<JsonReportRaw, ReporterFailed> =>
  Effect.map(
    Stream.fromAsyncIterable(input.events, failAsJsonReporter).pipe(
      Stream.filterMap(reportOf),
      Stream.run(Sink.last<reportApi.MutationTestResult>()),
    ),
    (last) => ({
      _tag: 'JsonReportCommand' as const,
      reported: Option.getOrUndefined(last),
      rendered: true,
      options: input.options,
    }),
  )

export const jsonReportCell = Sandwich.named('stryker.report.json')(readJsonReport)
  .decide(renderJsonReport)
  .write({
    JsonReportRendered: (rendered, raw) =>
      Effect.gen(function*() {
        const output = yield* ReporterOutput
        const fs = yield* FileSystem.FileSystem
        const path = yield* Path.Path
        const fileName = path.resolve(raw.options.jsonReporter.fileName)
        yield* Boolean.match(raw.options.logLevel === 'debug', {
          onTrue: () =>
            Effect.ignore(
              output.write('stderr', [`Using relative path ${path.normalize(raw.options.jsonReporter.fileName)}\n`]),
            ),
          onFalse: () => Effect.void,
        })
        yield* fs.makeDirectory(path.dirname(fileName), { recursive: true }).pipe(Effect.mapError(failAsJsonReporter))
        yield* fs.writeFileString(fileName, rendered.json).pipe(Effect.mapError(failAsJsonReporter))
        const url = yield* path.toFileUrl(fileName).pipe(Effect.mapError(failAsJsonReporter))
        yield* Effect.ignore(output.write('stdout', [`Your report can be found at: ${url.href}\n`]))
      }),
    JsonReportSuppressed: () => Effect.void,
    JsonReportRefused: (refused) => Effect.fail(failAsJsonReporter(refused.cause)),
    CommandRejected: ({ issue }) => Effect.fail(failAsJsonReporter(issue)),
  })

export const jsonReporterFactory = (context: Context.Context<ReporterOutput>): ReporterFactory => {
  const report: Cell.Cell<
    { readonly options: StrykerOptions; readonly events: AsyncIterable<ReporterEvent> },
    void,
    ReporterFailed,
    never
  > = Cell.provideContext(jsonReportCell, context)
  return (options) => (events) => report.run({ options, events })
}
