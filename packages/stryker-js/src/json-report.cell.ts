import { Cell, Sandwich } from '@systemfsoftware/effect-cell-types'
import { ErrorText } from '@systemfsoftware/stryker-js-instrumenter'
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
import * as S from 'effect/Schema'
import * as FileSystem from 'effect/FileSystem'
import * as Path from 'effect/Path'
import * as Sink from 'effect/Sink'
import * as Stream from 'effect/Stream'

import { ReporterOutput, type ReporterOutputShape } from './reporter-output.service.js'
import { renderJsonReport } from './render-json-report.workflow.js'

const failAsJsonReporter = <E = unknown>(cause: E): ReporterFailed =>
  ReporterFailed.make({
    reporterName: 'json',
    event: 'mutationTestReportReady',
    cause: Option.getOrElse(Option.map(Option.fromUndefinedOr(ErrorText.fromCause(cause)), (rendered) => rendered.text), () => ''),
  })

const reportOf = Filter.make((event: ReporterEvent): Result.Result<reportApi.MutationTestResult, 'not-ready'> =>
  Match.value(event).pipe(
    Match.tag('mutationTestReportReady', (ready) => Result.succeed(ready.report)),
    Match.orElse(() => Result.fail('not-ready' as const)),
  ))

const readJsonReport = (input: {
  readonly options: StrykerOptions
  readonly events: AsyncIterable<ReporterEvent>
}) =>
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

const jsonBytesOf = (report: reportApi.MutationTestResult): Effect.Effect<string, ReporterFailed> =>
  S.encodeEffect(S.fromJsonString(S.Unknown, { space: 0 }))(report).pipe(
    Effect.mapError(failAsJsonReporter),
  )

const announceRelativePath = (
  output: ReporterOutputShape,
  options: StrykerOptions,
  path: Path.Path,
): Effect.Effect<void> =>
  Boolean.match(options.logLevel === 'debug', {
    onTrue: () =>
      Effect.ignore(
        output.write('stderr', [`Using relative path ${path.normalize(options.jsonReporter.fileName)}\n`]),
      ),
    onFalse: () => Effect.void,
  })

export const jsonReportCell = Sandwich.named('stryker.report.json')(readJsonReport)
  .decide(renderJsonReport)
  .write({
    JsonReportRendered: (rendered, raw) =>
      Effect.gen(function*() {
        const output = yield* ReporterOutput
        const fs = yield* FileSystem.FileSystem
        const path = yield* Path.Path
        const json = yield* jsonBytesOf(rendered.report)
        const fileName = path.resolve(raw.options.jsonReporter.fileName)
        yield* announceRelativePath(output, raw.options, path)
        yield* fs.makeDirectory(path.dirname(fileName), { recursive: true }).pipe(Effect.mapError(failAsJsonReporter))
        yield* fs.writeFileString(fileName, json).pipe(Effect.mapError(failAsJsonReporter))
        const url = yield* path.toFileUrl(fileName).pipe(Effect.mapError(failAsJsonReporter))
        yield* Effect.ignore(output.write('stdout', [`Your report can be found at: ${url.href}\n`]))
      }),
    JsonReportSuppressed: () => Effect.void,
    CommandRejected: ({ issue }) => Effect.fail(failAsJsonReporter(issue)),
  })

type ReporterCellServices<C> = C extends Cell.Cell<infer _I, infer _A, infer _E, infer S> ? S : never

export const jsonReporterFactory = (
  context: Context.Context<ReporterCellServices<typeof jsonReportCell>>,
): ReporterFactory => {
  const report = Cell.provideContext(jsonReportCell, context)
  return (options) => (events) => Effect.asVoid(report.run({ options, events }))
}
