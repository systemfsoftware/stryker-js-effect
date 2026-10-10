import { Cell } from '@systemfsoftware/effect-cell-types'
import { HtmlReporter } from '@systemfsoftware/stryker-js-html-reporter'
import type { Options } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Effect from 'effect/Effect'
import { dual } from 'effect/Function'
import * as Layer from 'effect/Layer'
import * as Option from 'effect/Option'
import type { PlatformError } from 'effect/PlatformError'
import * as Predicate from 'effect/Predicate'

import type { Run } from '@systemfsoftware/stryker-js-contracts'
import type { Reports } from '@systemfsoftware/stryker-js-contracts'
import { Engine } from '@systemfsoftware/stryker-js-engine'
import { mergeConfig } from '../config/merge-config.js'

const HEADLESS_MODE: Run.ResolvedMode = { mode: 'machine', signal: 'flag', stdoutIsTTY: false }

const strykerRunLayer = Engine.makeRunEventStream(HEADLESS_MODE).pipe(
  Effect.flatMap((stream) =>
    Effect.map(
      Engine.forStream(HEADLESS_MODE, stream, {
        builtinReporters: { html: HtmlReporter.makeHtmlReporter },
        configOverlay: mergeConfig,
      }),
      (env) => Engine.stage(env, stream.queue),
    )
  ),
  Layer.unwrap,
  Layer.provide(Engine.drainLayer),
)

export const strykerCell: {
  (
    options: Options.PartialStrykerOptions,
    targetMutatePatterns?: readonly string[],
  ): Effect.Effect<Reports.MutationTestDone, Run.StageError | PlatformError, Engine.EnginePorts>
  (
    targetMutatePatterns?: readonly string[],
  ): (
    options: Options.PartialStrykerOptions,
  ) => Effect.Effect<Reports.MutationTestDone, Run.StageError | PlatformError, Engine.EnginePorts>
} = dual(
  (args) => Predicate.isObject(args[0]),
  (options: Options.PartialStrykerOptions, targetMutatePatterns?: readonly string[]) =>
    strykerRunLayer.pipe(
      Layer.build,
      Effect.flatMap((context) =>
        Cell.provideContext(Engine.mutationTestCell, context).run({
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
