import { ErrorText } from '@systemfsoftware/stryker-js-instrumenter'
import { Reporter as InterfaceReporter } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Context from 'effect/Context'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as Layer from 'effect/Layer'
import * as Option from 'effect/Option'
import * as Path from 'effect/Path'
import type * as Stdio from 'effect/Stdio'
import * as Stream from 'effect/Stream'

import { Reports } from '@systemfsoftware/stryker-js-contracts'
import {
  clearTextReporterFactory,
  jsonReporterFactory,
  progressReporterFactory,
  sarifReporterFactory,
} from '../reporter-factories.js'
import { layer as stdioReporterOutputLayer } from './stdio-reporter-output.js'

const failAsStreamDrain = <E = unknown>(cause: E): InterfaceReporter.ReporterFailed =>
  InterfaceReporter.ReporterFailed.make({
    reporterName: 'progress',
    event: 'mutationTestReportReady',
    cause: Option.getOrElse(Option.map(ErrorText.errorTextOf(cause), (rendered) => rendered.text), () => ''),
  })

const drainReporterFactory: InterfaceReporter.ReporterFactory = () => (events) =>
  Stream.runDrain(Stream.fromAsyncIterable(events, failAsStreamDrain))

const builtinLayer: Layer.Layer<Reports.Reporter, never, Reports.ReporterOutput | FileSystem.FileSystem | Path.Path> =
  Layer
    .effect(
      Reports.Reporter,
      Effect.map(Effect.all([Reports.ReporterOutput, FileSystem.FileSystem, Path.Path]), ([output, fs, path]) => {
        const context = Context.make(Reports.ReporterOutput, Reports.ReporterOutput.of({ write: output.write })).pipe(
          Context.add(FileSystem.FileSystem, fs),
          Context.add(Path.Path, path),
        )
        return Reports.Reporter.of({
          builtin: {
            [Reports.JsonReporterSchema.literal]: jsonReporterFactory(context),
            [Reports.HumanReporterSchema.literal]: clearTextReporterFactory(context),
            [Reports.ProgressReporterSchema.literal]: progressReporterFactory(context),
            [Reports.SarifReporterSchema.literal]: sarifReporterFactory(context),
            [Reports.StreamReporterSchema.literal]: drainReporterFactory,
          },
        })
      }),
    )

export const layer: Layer.Layer<Reports.Reporter, never, Stdio.Stdio | FileSystem.FileSystem | Path.Path> = builtinLayer
  .pipe(
    Layer.provide(stdioReporterOutputLayer),
  )
