import type { ReporterFactory } from '@systemfsoftware/stryker-js-plugin-interface'
import type * as Cause from 'effect/Cause'
import * as Context from 'effect/Context'
import * as Effect from 'effect/Effect'
import * as Exit from 'effect/Exit'
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

import { MutationReporting } from '../mutation-reporting.service.js'
import type { ResolvedMode } from '../output-mode.schema.js'
import { ProjectFiles } from '../project-files.service.js'
import { ReporterOutput } from '../reporter-output.service.js'
import { Reporter } from '../reporter.service.js'
import type { RunEventStream } from '../run-event-stream.service.js'
import { RunEvent } from '../run-event.schema.js'
import { RunEvents } from '../run-events.service.js'
import { IdGenerator } from '../Worker.service.js'
import type { EnginePorts, RunStageServices } from './StageServices.service.js'

export interface RunEnvironmentShape {
  readonly runId: string
  readonly resolvedMode: ResolvedMode
  readonly runStartedAt: number
  readonly basePath: string
  readonly builtinReporters: Readonly<Record<string, ReporterFactory>>
  readonly allowConsoleColors: boolean
}

export class RunEnvironment extends Context.Service<RunEnvironment, RunEnvironmentShape>()(
  '@systemfsoftware/stryker-js/run/RunEnvironment.service/RunEnvironment',
) {
  static readonly stage: {
    (
      env: RunEnvironmentShape,
      events?: Queue.Queue<RunEvent, Cause.Done>,
    ): Layer.Layer<RunStageServices, never, EnginePorts>
    (
      events?: Queue.Queue<RunEvent, Cause.Done>,
    ): (env: RunEnvironmentShape) => Layer.Layer<RunStageServices, never, EnginePorts>
  } = dual(
    (args) => Predicate.isObject(args[0]) && !Queue.isQueue(args[0]),
    (
      env: RunEnvironmentShape,
      events?: Queue.Queue<RunEvent, Cause.Done>,
    ): Layer.Layer<RunStageServices, never, EnginePorts> => {
      const eventsLayer: Layer.Layer<RunEvents> = Match.value(events).pipe(
        Match.when(undefined, () => Layer.effect(RunEvents, Queue.bounded<RunEvent, Cause.Done>(RunEvent.QUEUE_BOUND))),
        Match.orElse((queue) => Layer.succeed(RunEvents, queue)),
      )
      const stageLayer = Layer.mergeAll(
        Layer.succeed(RunEnvironment, env),
        eventsLayer,
        IdGenerator.layer,
        ProjectFiles.layer,
        Layer.effect(
          Scope.Scope,
          Effect.gen(function*() {
            const stageScope = yield* Scope.make()
            yield* Effect.addFinalizer(() => Scope.close(stageScope, Exit.void))
            return stageScope
          }),
        ),
      )
      return Layer.mergeAll(
        stageLayer,
        MutationReporting.layer.pipe(Layer.provide(stageLayer)),
        Reporter.layer.pipe(Layer.provide(ReporterOutput.layer), Layer.provide(stageLayer)),
      )
    },
  )

  static readonly forStream: {
    (
      mode: ResolvedMode,
      stream: RunEventStream,
      host: {
        readonly noColor?: string | undefined
        readonly builtinReporters: Readonly<Record<string, ReporterFactory>>
      },
    ): Effect.Effect<RunEnvironmentShape, PlatformError, FileSystem.FileSystem>
    (
      stream: RunEventStream,
      host: {
        readonly noColor?: string | undefined
        readonly builtinReporters: Readonly<Record<string, ReporterFactory>>
      },
    ): (mode: ResolvedMode) => Effect.Effect<RunEnvironmentShape, PlatformError, FileSystem.FileSystem>
  } = dual(
    3,
    (
      mode: ResolvedMode,
      stream: RunEventStream,
      host: {
        readonly noColor?: string | undefined
        readonly builtinReporters: Readonly<Record<string, ReporterFactory>>
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
          allowConsoleColors: mode.mode === 'human' &&
            Option.isNone(Option.filter(Option.fromUndefinedOr(host.noColor), S.is(S.NonEmptyString))),
        }),
      ),
  )
}
