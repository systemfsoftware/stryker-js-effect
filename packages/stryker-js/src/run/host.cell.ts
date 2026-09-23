import { Cell } from '@systemfsoftware/effect-cell-types'
import type { PartialStrykerOptions } from '@systemfsoftware/stryker-js-plugin-interface'
import { makeHtmlReporter } from '@systemfsoftware/stryker-js-html-reporter'
import * as Boolean from 'effect/Boolean'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import { dual } from 'effect/Function'
import * as Layer from 'effect/Layer'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as S from 'effect/Schema'
import type { PlatformError } from 'effect/PlatformError'

import type { CliRequest } from '../Cli.schema.js'
import type { ResolvedMode } from '../output-mode.schema.js'
import { RunEventDrain } from '../run-event-stream.service.js'
import type { RunEventStream } from '../run-event-stream.service.js'
import { RunEvents } from '../run-events.service.js'
import { StageError } from '../Run.schema.js'
import type { MutationTestDone } from './mutation-test.cell.js'
import { RunEnvironment } from './RunEnvironment.service.js'
import type { RunEnvironmentShape } from './RunEnvironment.service.js'
import { mutationTestCell } from './run-stages.cell.js'
import type { HostServices } from './host.service.js'
import type { PrepareExecutorArgs } from './prepare.cell.js'

const hostRunLayer = Layer.unwrap(
  Effect.map(
    Effect.all([RunEnvironment, RunEvents], { concurrency: 1 }),
    ([env, events]) => RunEnvironment.stage(env, events),
  ),
)

export const hostLayerOf = (host: HostServices) =>
  Layer.provideMerge(
    hostRunLayer,
    Layer.merge(Layer.succeed(RunEnvironment, host.env), Layer.succeed(RunEvents, host.events)),
  )

export const runOnHost = dual<
  (command: PrepareExecutorArgs) => (host: HostServices) => Effect.Effect<MutationTestDone, StageError, never>,
  (host: HostServices, command: PrepareExecutorArgs) => Effect.Effect<MutationTestDone, StageError, never>
>(
  2,
  (host, command) =>
    Effect.scoped(
      Effect.flatMap(Layer.build(hostLayerOf(host)), (context) =>
        Cell.provideContext(mutationTestCell, context).run(command)),
    ),
)

export const prepareCommandOf = dual<
  (
    targetMutatePatterns: string[] | undefined,
  ) => (options: PartialStrykerOptions) => PrepareExecutorArgs,
  (options: PartialStrykerOptions, targetMutatePatterns: string[] | undefined) => PrepareExecutorArgs
>(2, (options, targetMutatePatterns) => ({ cliOptions: options, targetMutatePatterns }))

const isColorEnabled = (mode: ResolvedMode, noColor: string | undefined) =>
  Boolean.match(mode.mode === 'human', {
    onTrue: () => Option.isNone(Option.filter(Option.fromUndefinedOr(noColor), S.is(S.NonEmptyString))),
    onFalse: () => false,
  })

export const hostOptionsOf = dual<
  (
    stream: RunEventStream,
    noColor: string | undefined,
  ) => (mode: ResolvedMode) => Effect.Effect<RunEnvironmentShape, PlatformError, FileSystem.FileSystem>,
  (
    mode: ResolvedMode,
    stream: RunEventStream,
    noColor: string | undefined,
  ) => Effect.Effect<RunEnvironmentShape, PlatformError, FileSystem.FileSystem>
>(3, (mode, stream, noColor) =>
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
  }))

export const progressStreamFileName = (request: Option.Option<CliRequest>): string =>
  Option.match(request, {
    onNone: () => RunEventDrain.DefaultProgressStreamFile,
    onSome: (cliRequest) =>
      Match.value(cliRequest).pipe(
        Match.tag('merge-reports', () => RunEventDrain.DefaultProgressStreamFile),
        Match.tag('run', (runRequest) =>
          Option.getOrElse(
            S.decodeUnknownOption(S.NonEmptyString)(runRequest.options['progressStreamFile']),
            () => RunEventDrain.DefaultProgressStreamFile,
          )),
        Match.exhaustive,
      ),
  })

export const applyProgressStreamFile = (fileName: string) =>
  Effect.gen(function*() {
    const drain = yield* RunEventDrain
    yield* drain.setProgressStreamFile(fileName)
  })
