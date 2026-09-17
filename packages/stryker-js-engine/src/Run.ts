import { Cell } from '@systemfsoftware/effect-cell-types'
import type { RunEvent } from '@systemfsoftware/stryker-js-language'
import { RunEvents } from '@systemfsoftware/stryker-js-language'
import type { PartialStrykerOptions } from '@systemfsoftware/stryker-js-language'
import type * as Cause from 'effect/Cause'
import * as Effect from 'effect/Effect'
import * as Exit from 'effect/Exit'
import * as Layer from 'effect/Layer'
import * as Match from 'effect/Match'
import * as Queue from 'effect/Queue'
import * as Scope from 'effect/Scope'

import { StageError } from './Run.schema.js'
import { dryRunCell } from './run/dry-run.cell.js'
import { instrumentCell } from './run/instrument.cell.js'
import { mutationTestCell } from './run/mutation-test.cell.js'
import type { MutationTestDone } from './run/mutation-test.cell.js'
import { runPrepare } from './run/prepare.js'
import { RunEnvironment } from './run/RunEnvironment.js'
import type { RunEnvironmentShape } from './run/RunEnvironment.js'
import type { EnginePorts, RunStageServices, StageServices } from './run/StageServices.js'
import { layer as idGeneratorLayer } from './Worker.js'

export const RUN_EVENTS_QUEUE_BOUND = 256

export const makeRunLayer = (
  env: RunEnvironmentShape,
  events?: Queue.Queue<RunEvent, Cause.Done>,
): Layer.Layer<RunStageServices, never, EnginePorts> => {
  const eventsLayer: Layer.Layer<RunEvents> = Match.value(events).pipe(
    Match.when(undefined, () => Layer.effect(RunEvents, Queue.bounded<RunEvent, Cause.Done>(RUN_EVENTS_QUEUE_BOUND))),
    Match.orElse((queue) => Layer.succeed(RunEvents, queue)),
  )
  return Layer.mergeAll(
    Layer.succeed(RunEnvironment, env),
    eventsLayer,
    idGeneratorLayer,
    Layer.effect(
      Scope.Scope,
      Effect.gen(function*() {
        const stageScope = yield* Scope.make()
        yield* Effect.addFinalizer(() => Scope.close(stageScope, Exit.void))
        return stageScope
      }),
    ),
  )
}

const mutationPipeline = Cell.andThen(
  instrumentCell,
  Cell.andThen(dryRunCell, mutationTestCell),
)

export const runMutationTest = (
  cliOptions: PartialStrykerOptions,
  targetMutatePatterns?: string[],
): Effect.Effect<MutationTestDone, StageError, StageServices> =>
  Effect.gen(function*() {
    const prepared = yield* runPrepare({ cliOptions, targetMutatePatterns })
    return yield* mutationPipeline.run(prepared)
  })

export const shouldKeepTempDir = (
  exit: Exit.Exit<unknown, unknown>,
  cleanTempDir: 'always' | boolean,
): boolean => Exit.isFailure(exit) && cleanTempDir !== 'always'
