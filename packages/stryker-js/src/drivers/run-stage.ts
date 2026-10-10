import { RunEvent } from '@systemfsoftware/stryker-js-cli-contract'
import type { Reporter as InterfaceReporter } from '@systemfsoftware/stryker-js-plugin-interface'
import type * as Cause from 'effect/Cause'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import { dual } from 'effect/Function'
import * as Layer from 'effect/Layer'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import type { PlatformError } from 'effect/PlatformError'
import * as Predicate from 'effect/Predicate'
import * as Queue from 'effect/Queue'
import * as S from 'effect/Schema'
import * as Scope from 'effect/Scope'

import type { ConfigOverlay } from '../config/stryker-config.schema.js'
import type { ResolvedMode } from '../output-mode.schema.js'
import type { RunEventStream } from '../run-event-stream.service.js'
import { RunEvents } from '../run-events.service.js'
import { RunEnvironment, type RunEnvironmentShape } from '../run/RunEnvironment.service.js'
import type { EnginePorts, RunStageServices } from '../run/StageServices.service.js'

import { layer as idGeneratorLayer } from './id-generator.js'
import { layer as mutationReportingLayer } from './mutation-reporting.js'
import { layer as phaseClockLayer } from './phase-clock.js'
import { layer as projectFilesLayer } from './project-files.js'
import { workerReportsLayer } from './run-events.js'

export const stage: {
  (
    env: RunEnvironmentShape,
    events?: Queue.Queue<RunEvent.RunEvent, Cause.Done>,
  ): Layer.Layer<RunStageServices, never, EnginePorts>
  (
    events?: Queue.Queue<RunEvent.RunEvent, Cause.Done>,
  ): (env: RunEnvironmentShape) => Layer.Layer<RunStageServices, never, EnginePorts>
} = dual(
  (args) => Predicate.isObject(args[0]) && !Queue.isQueue(args[0]),
  (
    env: RunEnvironmentShape,
    events?: Queue.Queue<RunEvent.RunEvent, Cause.Done>,
  ): Layer.Layer<RunStageServices, never, EnginePorts> => stageLayerOf(env, events),
)

export const forStream: {
  (
    mode: ResolvedMode,
    stream: RunEventStream,
    host: {
      readonly noColor?: string | undefined
      readonly builtinReporters: Readonly<Record<string, InterfaceReporter.ReporterFactory>>
      readonly configOverlay: ConfigOverlay
    },
  ): Effect.Effect<RunEnvironmentShape, PlatformError, FileSystem.FileSystem>
  (
    stream: RunEventStream,
    host: {
      readonly noColor?: string | undefined
      readonly builtinReporters: Readonly<Record<string, InterfaceReporter.ReporterFactory>>
      readonly configOverlay: ConfigOverlay
    },
  ): (mode: ResolvedMode) => Effect.Effect<RunEnvironmentShape, PlatformError, FileSystem.FileSystem>
} = dual(
  3,
  (
    mode: ResolvedMode,
    stream: RunEventStream,
    host: {
      readonly noColor?: string | undefined
      readonly builtinReporters: Readonly<Record<string, InterfaceReporter.ReporterFactory>>
      readonly configOverlay: ConfigOverlay
    },
  ): Effect.Effect<RunEnvironmentShape, PlatformError, FileSystem.FileSystem> =>
    Effect.map(
      Effect.flatMap(FileSystem.FileSystem, (fs) => fs.realPath('.')),
      (basePath) => ({
        runId: stream.runId,
        resolvedMode: mode,
        runStartedAt: stream.startedAt,
        basePath,
        builtinReporters: host.builtinReporters,
        configOverlay: host.configOverlay,
        allowConsoleColors: mode.mode === 'human' &&
          Option.isNone(Option.filter(Option.fromUndefinedOr(host.noColor), S.is(S.NonEmptyString))),
      }),
    ),
)

const stageLayerOf = (
  env: RunEnvironmentShape,
  events?: Queue.Queue<RunEvent.RunEvent, Cause.Done>,
): Layer.Layer<RunStageServices, never, EnginePorts> => {
  const eventsLayer: Layer.Layer<RunEvents> = Match.value(events).pipe(
    Match.when(
      undefined,
      () => Layer.effect(RunEvents, Queue.bounded<RunEvent.RunEvent, Cause.Done>(RunEvent.RunEvent.QUEUE_BOUND)),
    ),
    Match.orElse((queue) => Layer.succeed(RunEvents, queue)),
  )
  const stageLayer = Layer.mergeAll(
    Layer.succeed(RunEnvironment, env),
    eventsLayer,
    workerReportsLayer.pipe(Layer.provide(eventsLayer)),
    phaseClockLayer(env.runStartedAt),
    idGeneratorLayer,
    projectFilesLayer,
    Layer.effect(
      Scope.Scope,
      Effect.gen(function*() {
        const stageScope = yield* Scope.make()
        yield* Effect.addFinalizer((exit) => Scope.close(stageScope, exit))
        return stageScope
      }),
    ),
  )
  return Layer.mergeAll(stageLayer, mutationReportingLayer.pipe(Layer.provide(stageLayer)))
}
