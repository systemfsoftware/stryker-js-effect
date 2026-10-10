import { ErrorText } from '@systemfsoftware/stryker-js-instrumenter'
import { Reporter as InterfaceReporter } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Context from 'effect/Context'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as Layer from 'effect/Layer'
import * as Option from 'effect/Option'
import * as Path from 'effect/Path'
import * as Stream from 'effect/Stream'

import {
  clearTextReporterFactory,
  jsonReporterFactory,
  progressReporterFactory,
  sarifReporterFactory,
} from '../reporter-factories.js'
import {
  HumanReporterSchema,
  JsonReporterSchema,
  ProgressReporterSchema,
  SarifReporterSchema,
  StreamReporterSchema,
} from '../reporter-name.schema.js'
import { ReporterOutput } from '../reporter-output.service.js'
import { Reporter } from '../reporter.service.js'

const failAsStreamDrain = <E = unknown>(cause: E): InterfaceReporter.ReporterFailed =>
  InterfaceReporter.ReporterFailed.make({
    reporterName: 'progress',
    event: 'mutationTestReportReady',
    cause: Option.getOrElse(Option.map(ErrorText.errorTextOf(cause), (rendered) => rendered.text), () => ''),
  })

const drainReporterFactory: InterfaceReporter.ReporterFactory = () => (events) =>
  Stream.runDrain(Stream.fromAsyncIterable(events, failAsStreamDrain))

export const layer: Layer.Layer<Reporter, never, ReporterOutput | FileSystem.FileSystem | Path.Path> = Layer
  .effect(
    Reporter,
    Effect.map(Effect.all([ReporterOutput, FileSystem.FileSystem, Path.Path]), ([output, fs, path]) => {
      const context = Context.make(ReporterOutput, ReporterOutput.of({ write: output.write })).pipe(
        Context.add(FileSystem.FileSystem, fs),
        Context.add(Path.Path, path),
      )
      return Reporter.of({
        builtin: {
          [JsonReporterSchema.literal]: jsonReporterFactory(context),
          [HumanReporterSchema.literal]: clearTextReporterFactory(context),
          [ProgressReporterSchema.literal]: progressReporterFactory(context),
          [SarifReporterSchema.literal]: sarifReporterFactory(context),
          [StreamReporterSchema.literal]: drainReporterFactory,
        },
      })
    }),
  )
