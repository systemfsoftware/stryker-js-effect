import { errorToString } from '@systemfsoftware/stryker-js-language'
import type * as schema from '@systemfsoftware/stryker-js-language'
import type { ReporterEvent, ReporterFactory } from '@systemfsoftware/stryker-js-language'
import { ReporterFailed } from '@systemfsoftware/stryker-js-language'
import type { StrykerOptions } from '@systemfsoftware/stryker-js-language'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Path from 'effect/Path'
import * as S from 'effect/Schema'
import * as Stdio from 'effect/Stdio'
import * as Stream from 'effect/Stream'
import { write } from './reporter-output.js'

export interface BuiltinReporterServices {
  readonly fileSystem: FileSystem.FileSystem
  readonly path: Path.Path
  readonly stdio: Stdio.Stdio
}

const failAsJsonReporter = (cause: unknown): ReporterFailed =>
  ReporterFailed.make({
    reporterName: 'json',
    event: 'mutationTestReportReady',
    cause: errorToString(cause),
  })

const writeReport = (
  services: BuiltinReporterServices,
  options: StrykerOptions,
  report: schema.MutationTestResult,
): Effect.Effect<void, ReporterFailed, never> =>
  Effect.gen(function*() {
    const json = yield* S.encodeEffect(S.fromJsonString(S.Unknown, { space: 0 }))(report).pipe(Effect.orDie)
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const fileName = path.resolve(options.jsonReporter.fileName)
    if (options.logLevel === 'debug') {
      yield* Effect.ignore(
        write(services.stdio, 'stderr', [`Using relative path ${path.normalize(options.jsonReporter.fileName)}\n`]),
      )
    }
    yield* fs.makeDirectory(path.dirname(fileName), { recursive: true }).pipe(
      Effect.mapError(failAsJsonReporter),
    )
    yield* fs.writeFileString(fileName, json).pipe(Effect.mapError(failAsJsonReporter))
    const url = yield* path.toFileUrl(fileName).pipe(Effect.mapError(failAsJsonReporter))
    yield* Effect.ignore(write(services.stdio, 'stdout', [`Your report can be found at: ${url.href}\n`]))
  }).pipe(
    Effect.provideService(FileSystem.FileSystem, services.fileSystem),
    Effect.provideService(Path.Path, services.path),
  )

interface SeenReport {
  report?: schema.MutationTestResult
}

const rememberReport = (seen: SeenReport, event: ReporterEvent): void => {
  Match.value(event).pipe(
    Match.tag('mutationTestReportReady', (ready) => {
      seen.report = ready.report
    }),
    Match.orElse(() => undefined),
  )
}

const streamErrorOf = (cause: unknown): ReporterFailed =>
  ReporterFailed.make({ reporterName: 'json', event: 'mutationTestReportReady', cause: errorToString(cause) })
export const makeJsonReporter = (services: BuiltinReporterServices): ReporterFactory => (options) => (events) => {
  const seen: SeenReport = {}
  return Stream.runForEach(
    Stream.fromAsyncIterable(events, streamErrorOf),
    (event) => Effect.sync(() => rememberReport(seen, event)),
  ).pipe(
    Effect.andThen(Effect.sync(() => seen.report)),
    Effect.flatMap((report) =>
      Option.match(Option.fromUndefinedOr(report), {
        onNone: () => Effect.void,
        onSome: (ready) => writeReport(services, options, ready),
      })
    ),
  )
}
