import { Cell } from '@systemfsoftware/effect-cell-types'
import { HtmlReporter } from '@systemfsoftware/stryker-js-html-reporter'
import type { Options } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Effect from 'effect/Effect'
import { dual } from 'effect/Function'
import * as Layer from 'effect/Layer'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import type { PlatformError } from 'effect/PlatformError'
import * as Predicate from 'effect/Predicate'

import { concurrencyCell } from '../concurrency.cell.js'
import type { ConfigReadError } from '../ConfigError.schema.js'
import type { ResolvedMode } from '../output-mode.schema.js'
import { readProjectCell } from '../read-project.cell.js'
import { makeRunEventStream, RunEventDrainLive } from '../run-event-stream.service.js'
import { StageError } from '../Run.schema.js'
import { dryRunCell } from './dry-run.cell.js'
import { instrumentCell } from './instrument.cell.js'
import { loadConfigCell } from './load-config.cell.js'
import { mutationTestCell as mutationTestStageCell } from './mutation-test.cell.js'
import type { MutationTestDone } from './mutation-test.cell.js'
import { prepareCell } from './prepare.cell.js'
import type { PrepareExecutorArgs } from './prepare.cell.js'
import { RunEnvironment } from './RunEnvironment.service.js'
import type { EnginePorts, StageServices } from './StageServices.service.js'

const configReadReasonOf = (cause: ConfigReadError): string =>
  Match.value(cause).pipe(
    Match.tag('ConfigError', (refused) => refused.message),
    Match.orElse(() => 'Failed to read config'),
  )

const prepareStageCell = Cell.andThen(
  Cell.andThen(
    Cell.andThen(
      Cell.mapError(
        loadConfigCell,
        (cause) => StageError.make({ stage: 'prepare', reason: configReadReasonOf(cause), cause }),
      ),
      Cell.mapError(
        readProjectCell,
        (cause) => StageError.make({ stage: 'prepare', reason: 'Failed to read project', cause }),
      ),
    ),
    prepareCell,
  ),
  Cell.andThen(
    Cell.andThen(concurrencyCell, instrumentCell),
    Cell.andThen(dryRunCell, mutationTestStageCell),
  ),
)

export const mutationTestCell: Cell.Cell<PrepareExecutorArgs, MutationTestDone, StageError, StageServices> =
  prepareStageCell

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
