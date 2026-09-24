import { ErrorText } from '@systemfsoftware/stryker-js-instrumenter'
import { Reporter as InterfaceReporter } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Context from 'effect/Context'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as Layer from 'effect/Layer'
import * as Option from 'effect/Option'
import * as Path from 'effect/Path'
import * as Stream from 'effect/Stream'

import { clearTextReporterFactory } from './clear-text-report.cell.js'
import { jsonReporterFactory } from './json-report.cell.js'
import { progressReporterFactory } from './progress-report.cell.js'
import { ReporterOutput } from './reporter-output.service.js'

export interface ReporterShape {
  readonly builtin: Readonly<Record<string, InterfaceReporter.ReporterFactory>>
}

const failAsStreamDrain = <E = unknown>(cause: E): InterfaceReporter.ReporterFailed =>
  InterfaceReporter.ReporterFailed.make({
    reporterName: 'progress',
    event: 'mutationTestReportReady',
    cause: Option.getOrElse(Option.map(ErrorText.ErrorText.fromCause(cause), (rendered) => rendered.text), () => ''),
  })

const drainReporterFactory: InterfaceReporter.ReporterFactory = () => (events) =>
  Stream.runDrain(Stream.fromAsyncIterable(events, failAsStreamDrain))

export class Reporter extends Context.Service<Reporter, ReporterShape>()(
  '@systemfsoftware/stryker-js/reporter.service/Reporter',
) {
  static readonly layer: Layer.Layer<Reporter, never, ReporterOutput | FileSystem.FileSystem | Path.Path> = Layer
    .effect(
      Reporter,
      Effect.map(Effect.all([ReporterOutput, FileSystem.FileSystem, Path.Path]), ([output, fs, path]) => {
        const context = Context.make(ReporterOutput, ReporterOutput.of({ write: output.write })).pipe(
          Context.add(FileSystem.FileSystem, fs),
          Context.add(Path.Path, path),
        )
        return Reporter.of({
          builtin: {
            'json': jsonReporterFactory(context),
            'clear-text': clearTextReporterFactory(context),
            'progress': progressReporterFactory(context),
            'progress-stream': drainReporterFactory,
          },
        })
      }),
    )
}
