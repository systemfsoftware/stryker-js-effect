import type { ReporterFactory } from '@systemfsoftware/stryker-js-plugin-interface'
import type * as Cause from 'effect/Cause'
import * as Context from 'effect/Context'
import * as Effect from 'effect/Effect'
import * as Exit from 'effect/Exit'
import { dual } from 'effect/Function'
import * as Layer from 'effect/Layer'
import * as Match from 'effect/Match'
import * as Predicate from 'effect/Predicate'
import * as Queue from 'effect/Queue'
import * as Scope from 'effect/Scope'

import type { ResolvedMode } from '../output-mode.schema.js'
import { MutationReporting } from '../mutation-reporting.service.js'
import { ProjectFiles } from '../project-files.service.js'
import { Reporter } from '../reporter.service.js'
import { ReporterOutput } from '../reporter-output.service.js'
import { RUN_EVENTS_QUEUE_BOUND } from '../Run.js'
import type { RunEvent } from '../run-event.schema.js'
import { RunEvents } from '../run-events.service.js'
import { layer as idGeneratorLayer } from '../Worker.service.js'
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
  '@systemfsoftware/stryker-js/run/RunEnvironment',
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
        Match.when(undefined, () =>
          Layer.effect(RunEvents, Queue.bounded<RunEvent, Cause.Done>(RUN_EVENTS_QUEUE_BOUND))),
        Match.orElse((queue) => Layer.succeed(RunEvents, queue)),
      )
      const stageLayer = Layer.mergeAll(
        Layer.succeed(RunEnvironment, env),
        eventsLayer,
        idGeneratorLayer,
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
        Reporter.layer.pipe(Layer.provide(ReporterOutput.layer)).pipe(Layer.provide(stageLayer)),
      )
    },
  )
}
