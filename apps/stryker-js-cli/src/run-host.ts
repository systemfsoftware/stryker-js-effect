import {
  makeRunLayer,
  type ResolvedMode,
  type RunEnvironmentShape,
  runMutationTest,
  type WiredRunLayer,
} from '@systemfsoftware/stryker-js-engine'
import { makeHtmlReporter } from '@systemfsoftware/stryker-js-html-reporter'
import { type RunEvent, RunEvents } from '@systemfsoftware/stryker-js-language'
import * as Cause from 'effect/Cause'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import type * as Queue from 'effect/Queue'
import type { CliRequest } from './Cli.schema.js'
import { isColorEnabled } from './Output.js'
import type { RunEventStream } from './Output.js'
import { nodePlatformLayer } from './platform/node.js'
import { DEFAULT_PROGRESS_STREAM_FILE } from './StreamFile.js'
import type { StrykerRun } from './StrykerRun.js'

export const hostRunLayer = (
  hostOptions: RunEnvironmentShape,
  queue?: Queue.Queue<RunEvent, Cause.Done>,
): WiredRunLayer => makeRunLayer(hostOptions, queue).pipe(Layer.provideMerge(nodePlatformLayer))

export const runMutationTestWith =
  (runLayer: WiredRunLayer, queue: Queue.Queue<RunEvent, Cause.Done>): StrykerRun =>
  (...args: Parameters<StrykerRun>) =>
    Effect.scoped(runMutationTest(...args)).pipe(
      Effect.provide(runLayer),
      Effect.provideService(RunEvents, queue),
    )

export function hostOptionsOf(
  mode: ResolvedMode,
  stream: RunEventStream,
  noColor: string | undefined,
): RunEnvironmentShape {
  return {
    runId: stream.runId,
    resolvedMode: mode,
    runStartedAt: stream.startedAt,
    basePath: process.cwd(),
    builtinReporters: { html: makeHtmlReporter },
    allowConsoleColors: isColorEnabled(mode, noColor),
  }
}

export const isNonEmptyString = (value: unknown): value is string => typeof value === 'string' && value.length > 0

export const progressStreamFileName = (request: Option.Option<CliRequest>): string =>
  Option.match(request, {
    onNone: () => DEFAULT_PROGRESS_STREAM_FILE,
    onSome: (cliRequest) =>
      Match.value(cliRequest).pipe(
        Match.tag('merge-reports', () => DEFAULT_PROGRESS_STREAM_FILE),
        Match.tag('run', (runRequest) =>
          Option.getOrElse(
            Option.filter(Option.fromNullishOr(runRequest.options['progressStreamFile']), isNonEmptyString),
            () => DEFAULT_PROGRESS_STREAM_FILE,
          )),
        Match.exhaustive,
      ),
  })

export const applyProgressStreamFile = (stream: RunEventStream, fileName: string): Effect.Effect<void, never, never> =>
  Option.match(Option.fromUndefinedOr(stream.setProgressStreamFile), {
    onNone: () => Effect.void,
    onSome: (setFileName) => setFileName(fileName),
  })
