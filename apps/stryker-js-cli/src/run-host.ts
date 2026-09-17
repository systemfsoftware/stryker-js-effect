import {
  makeRunLayer,
  type ResolvedMode,
  type RunEnvironmentShape,
  runMutationTest,
  type WiredRunLayer,
} from '@systemfsoftware/stryker-js-engine'
import { makeHtmlReporter } from '@systemfsoftware/stryker-js-html-reporter'
import { type RunEvent } from '@systemfsoftware/stryker-js-language'
import * as Cause from 'effect/Cause'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as Layer from 'effect/Layer'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import type { PlatformError } from 'effect/PlatformError'
import type * as Queue from 'effect/Queue'
import * as S from 'effect/Schema'
import type { CliRequest } from './Cli.schema.js'
import { isColorEnabled } from './Output.js'
import type { RunEventStream } from './Output.js'
import { nodePlatformLayer } from './platform/node.js'
import { DEFAULT_PROGRESS_STREAM_FILE } from './StreamFile.js'
import type { StrykerRun } from './StrykerRun.js'

export interface HostBinding {
  readonly options: RunEnvironmentShape
  readonly events: Queue.Queue<RunEvent, Cause.Done>
}

export const hostRunLayer = (binding: HostBinding): WiredRunLayer =>
  makeRunLayer(binding.options, binding.events).pipe(Layer.provideMerge(nodePlatformLayer))

export const runWithHost = (layer: WiredRunLayer): StrykerRun => (...args: Parameters<StrykerRun>) =>
  runMutationTest(...args).pipe(Effect.scoped, Effect.provide(layer))

export const hostOptionsOf = (
  mode: ResolvedMode,
  stream: RunEventStream,
  noColor: string | undefined,
): Effect.Effect<RunEnvironmentShape, PlatformError, FileSystem.FileSystem> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    return {
      runId: stream.runId,
      resolvedMode: mode,
      runStartedAt: stream.startedAt,
      basePath: yield* fs.realPath('.'),
      builtinReporters: { html: makeHtmlReporter },
      allowConsoleColors: isColorEnabled(mode, noColor),
    }
  })

export const progressStreamFileName = (request: Option.Option<CliRequest>): string =>
  Option.match(request, {
    onNone: () => DEFAULT_PROGRESS_STREAM_FILE,
    onSome: (cliRequest) =>
      Match.value(cliRequest).pipe(
        Match.tag('merge-reports', () => DEFAULT_PROGRESS_STREAM_FILE),
        Match.tag('run', (runRequest) =>
          Option.getOrElse(
            S.decodeUnknownOption(S.NonEmptyString)(runRequest.options['progressStreamFile']),
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
