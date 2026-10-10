import { Cell } from '@systemfsoftware/effect-cell-types'
import { HtmlReporter } from '@systemfsoftware/stryker-js-html-reporter'
import type { Options } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Effect from 'effect/Effect'
import { dual } from 'effect/Function'
import * as Layer from 'effect/Layer'
import * as Option from 'effect/Option'
import type { PlatformError } from 'effect/PlatformError'
import * as Predicate from 'effect/Predicate'

import { mergeConfig } from '../config/merge-config.js'
import { drainLayer } from '../drivers/run-event-stream.js'
import { makeRunEventStream } from '../drivers/run-event-stream.js'
import { forStream, stage } from '../drivers/run-stage.js'
import type { MutationTestDone } from '../mutation-reporting.service.js'
import type { ResolvedMode } from '../output-mode.schema.js'
import { StageError } from '../Run.schema.js'
import { mutationTestCell } from './run-stages.cell.js'
import type { EnginePorts } from './StageServices.service.js'

const HEADLESS_MODE: ResolvedMode = { mode: 'machine', signal: 'flag', stdoutIsTTY: false }

const strykerRunLayer = makeRunEventStream(HEADLESS_MODE).pipe(
  Effect.flatMap((stream) =>
    Effect.map(
      forStream(HEADLESS_MODE, stream, {
        builtinReporters: { html: HtmlReporter.makeHtmlReporter },
        configOverlay: mergeConfig,
      }),
      (env) => stage(env, stream.queue),
    )
  ),
  Layer.unwrap,
  Layer.provide(drainLayer),
)

export const strykerCell: {
  (
    options: Options.PartialStrykerOptions,
    targetMutatePatterns?: readonly string[],
  ): Effect.Effect<MutationTestDone, StageError | PlatformError, EnginePorts>
  (
    targetMutatePatterns?: readonly string[],
  ): (
    options: Options.PartialStrykerOptions,
  ) => Effect.Effect<MutationTestDone, StageError | PlatformError, EnginePorts>
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
