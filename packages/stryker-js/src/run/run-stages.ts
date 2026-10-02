import { Cell } from '@systemfsoftware/effect-cell-types'
import { HtmlReporter } from '@systemfsoftware/stryker-js-html-reporter'
import type { Options } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Effect from 'effect/Effect'
import { dual } from 'effect/Function'
import * as Layer from 'effect/Layer'
import * as Option from 'effect/Option'
import type { PlatformError } from 'effect/PlatformError'
import * as Predicate from 'effect/Predicate'

import type { ResolvedMode } from '../output-mode.schema.js'
import { makeRunEventStream, RunEventDrainLive } from '../run-event-stream.service.js'
import type { RunFailure } from '../Run.schema.js'
import type { MutationTestDone } from './mutation-test.cell.js'
import { mutationTestCell } from './run-stages.cell.js'
import { RunEnvironment } from './RunEnvironment.service.js'
import type { EnginePorts } from './StageServices.service.js'

const HEADLESS_MODE: ResolvedMode = { mode: 'machine', signal: 'flag', stdoutIsTTY: false }

const strykerRunLayer = makeRunEventStream(HEADLESS_MODE).pipe(
  Effect.flatMap((stream) =>
    Effect.map(
      RunEnvironment.forStream(HEADLESS_MODE, stream, { builtinReporters: { html: HtmlReporter.makeHtmlReporter } }),
      (env) => RunEnvironment.stage(env, stream.queue),
    )
  ),
  Layer.unwrap,
  Layer.provide(RunEventDrainLive),
)

export const strykerCell: {
  (
    options: Options.PartialStrykerOptions,
    targetMutatePatterns?: readonly string[],
  ): Effect.Effect<MutationTestDone, RunFailure | PlatformError, EnginePorts>
  (
    targetMutatePatterns?: readonly string[],
  ): (
    options: Options.PartialStrykerOptions,
  ) => Effect.Effect<MutationTestDone, RunFailure | PlatformError, EnginePorts>
} = dual(
  (args) => Predicate.isObject(args[0]),
  (options: Options.PartialStrykerOptions, targetMutatePatterns?: readonly string[]) =>
    strykerRunLayer.pipe(
      Layer.build,
      Effect.flatMap((context) =>
        Cell.provideContext(mutationTestCell, context).run({
          cliOptions: options,
          targetMutatePatterns: Option.match(Option.fromUndefinedOr(targetMutatePatterns), {
            onNone: () => undefined,
            onSome: (present) => [...present],
          }),
        })
      ),
      Effect.scoped,
    ),
)
