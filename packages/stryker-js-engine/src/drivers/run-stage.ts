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
import type { EnginePorts, RunStageServices } from '../run/StageServices.service.js'

import { Run } from '@systemfsoftware/stryker-js-contracts'
import type { Configuration } from '@systemfsoftware/stryker-js-contracts'
import { layer as idGeneratorLayer } from './id-generator.js'
import { layer as mutationReportingLayer } from './mutation-reporting.js'
import { layer as phaseClockLayer } from './phase-clock.js'
import { layer as projectFilesLayer } from './project-files.js'
import { workerReportsLayer } from './run-events.js'

export const stage: {
  (
    env: Run.RunEnvironmentShape,
    events?: Queue.Queue<RunEvent.RunEvent, Cause.Done>,
  ): Layer.Layer<RunStageServices, never, EnginePorts>
  (
    events?: Queue.Queue<RunEvent.RunEvent, Cause.Done>,
  ): (env: Run.RunEnvironmentShape) => Layer.Layer<RunStageServices, never, EnginePorts>
} = dual(
  (args) => Predicate.isObject(args[0]) && !Queue.isQueue(args[0]),
  (
    env: Run.RunEnvironmentShape,
    events?: Queue.Queue<RunEvent.RunEvent, Cause.Done>,
  ): Layer.Layer<RunStageServices, never, EnginePorts> => stageLayerOf(env, events),
)

export const forStream: {
  (
    mode: Run.ResolvedMode,
    stream: Run.RunEventStream,
    host: {
      readonly noColor?: string | undefined
      readonly builtinReporters: Readonly<Record<string, InterfaceReporter.ReporterFactory>>
      readonly configOverlay: Configuration.ConfigOverlay
    },
  ): Effect.Effect<Run.RunEnvironmentShape, PlatformError, FileSystem.FileSystem>
  (
    stream: Run.RunEventStream,
    host: {
      readonly noColor?: string | undefined
      readonly builtinReporters: Readonly<Record<string, InterfaceReporter.ReporterFactory>>
      readonly configOverlay: Configuration.ConfigOverlay
    },
  ): (mode: Run.ResolvedMode) => Effect.Effect<Run.RunEnvironmentShape, PlatformError, FileSystem.FileSystem>
} = dual(
  3,
  (
    mode: Run.ResolvedMode,
    stream: Run.RunEventStream,
    host: {
      readonly noColor?: string | undefined
      readonly builtinReporters: Readonly<Record<string, InterfaceReporter.ReporterFactory>>
      readonly configOverlay: Configuration.ConfigOverlay
    },
  ): Effect.Effect<Run.RunEnvironmentShape, PlatformError, FileSystem.FileSystem> =>
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
  env: Run.RunEnvironmentShape,
  events?: Queue.Queue<RunEvent.RunEvent, Cause.Done>,
): Layer.Layer<RunStageServices, never, EnginePorts> => {
  const eventsLayer: Layer.Layer<Run.RunEvents> = Match.value(events).pipe(
    Match.when(
      undefined,
      () => Layer.effect(Run.RunEvents, Queue.bounded<RunEvent.RunEvent, Cause.Done>(RunEvent.RunEvent.QUEUE_BOUND)),
    ),
    Match.orElse((queue) => Layer.succeed(Run.RunEvents, queue)),
  )
  const stageLayer = Layer.mergeAll(
    Layer.succeed(Run.RunEnvironment, env),
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
