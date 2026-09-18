import { Cell } from '@systemfsoftware/effect-cell-types'
import { makeHtmlReporter } from '@systemfsoftware/stryker-js-html-reporter'
import type { PartialStrykerOptions } from '@systemfsoftware/stryker-js-plugin-interface'
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
import { type ResolvedMode } from './output-mode.js'
import { isColorEnabled } from './Output.js'
import type { RunEventStream } from './Output.js'
import { nodePlatformLayer } from './platform/node.js'
import { makeRunLayer, mutationTestCell } from './Run.js'
import { type StageError } from './Run.schema.js'
import { type MutationTestDone } from './run/mutation-test.cell.js'
import { type PrepareExecutorArgs } from './run/prepare.cell.js'
import { RunEnvironment, type RunEnvironmentShape } from './run/RunEnvironment.js'
import { type EnginePorts, type RunStageServices } from './run/StageServices.js'
import { type RunEvent, RunEvents } from './RunEvents.js'
import { DEFAULT_PROGRESS_STREAM_FILE } from './StreamFile.js'

export interface HostServices {
  readonly env: RunEnvironmentShape
  readonly events: Queue.Queue<RunEvent, Cause.Done>
}

export const hostRunLayer: Layer.Layer<RunStageServices | EnginePorts, never, RunEnvironment | RunEvents> = Layer
  .unwrap(
    Effect.map(
      Effect.all([RunEnvironment, RunEvents], { concurrency: 1 }),
      ([env, events]) => makeRunLayer(env, events),
    ),
  ).pipe(Layer.provideMerge(nodePlatformLayer))

export const hostMutationTest: Cell.Cell<
  PrepareExecutorArgs,
  MutationTestDone,
  StageError,
  RunEnvironment | RunEvents
> = Cell.provide(mutationTestCell, hostRunLayer)

export const onHost = <A, E>(
  host: HostServices,
  effect: Effect.Effect<A, E, RunStageServices | EnginePorts | RunEnvironment | RunEvents>,
): Effect.Effect<A, E, never> =>
  effect.pipe(
    Effect.provide(hostRunLayer),
    Effect.provideService(RunEnvironment, host.env),
    Effect.provideService(RunEvents, host.events),
  )

export const runOnHost = (
  host: HostServices,
  command: PrepareExecutorArgs,
): Effect.Effect<MutationTestDone, StageError, never> => onHost(host, Effect.scoped(hostMutationTest.run(command)))

export const prepareCommandOf = (
  options: PartialStrykerOptions,
  targetMutatePatterns: string[] | undefined,
): PrepareExecutorArgs => ({ cliOptions: options, targetMutatePatterns })

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
