import { Sandwich } from '@systemfsoftware/effect-cell-types'
import { Options } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Effect from 'effect/Effect'
import type * as FileSystem from 'effect/FileSystem'
import type * as Path from 'effect/Path'
import type * as S from 'effect/Schema'

import { SpanTaxonomy } from '@systemfsoftware/stryker-js-cli-contract'
import type { ConfigError } from '../ConfigError.schema.js'
import type { RunEvents } from '../run-events.service.js'
import {
  describedConfigErrorOf,
  emitPreparePhaseEntered,
  failConfigWith,
  type LoadedConfig,
  readLoadConfig,
} from './load-config.js'
import type { PhaseClock } from './phase-clock.service.js'
import type { ConfigReadError } from './read-config-document.js'
import { type ConfigFromDefaults, type ConfigFromFile, resolveConfig } from './resolve-config.workflow.js'
import { RunEnvironment } from './RunEnvironment.service.js'

export type { ConfigInvocation, LoadedConfig } from './load-config.js'
export type { ConfigReadError } from './read-config-document.js'
export type { ValidationSchemaDocument } from './validate-options-admission.workflow.js'

interface LoadConfigInput {
  readonly cliOptions: Options.PartialStrykerOptions
  readonly targetMutatePatterns: readonly string[] | undefined
}

const readRunConfig = Effect.fn(SpanTaxonomy.Spans.configReadRun.name)(function*(input: LoadConfigInput) {
  const env = yield* RunEnvironment
  const raw = yield* readLoadConfig({
    cliOptions: input.cliOptions,
    invocation: { command: 'run', mode: env.resolvedMode.mode },
  }).pipe(Effect.tapCause(() => emitPreparePhaseEntered))
  return {
    ...raw,
    targetMutatePatterns: input.targetMutatePatterns,
    basePath: env.basePath,
  }
})

export const loadConfigCell: Sandwich.WrittenCell<
  LoadConfigInput,
  ConfigReadError,
  FileSystem.FileSystem | Path.Path | PhaseClock | RunEnvironment | RunEvents,
  S.Union<readonly [typeof ConfigFromFile, typeof ConfigFromDefaults]>,
  LoadedConfig & { readonly targetMutatePatterns: readonly string[] | undefined },
  ConfigError,
  PhaseClock | RunEnvironment | RunEvents
> = Sandwich.named(SpanTaxonomy.Spans.loadConfig.name)(readRunConfig)
  .decide(resolveConfig)
  .write({
    ConfigFromFile: ({ options }, raw) =>
      Effect.succeed({
        options,
        targetMutatePatterns: raw.targetMutatePatterns,
        basePath: raw.basePath,
      }),
    ConfigFromDefaults: ({ options }, raw) =>
      Effect.succeed({
        options,
        targetMutatePatterns: raw.targetMutatePatterns,
        basePath: raw.basePath,
      }),
    ConfigOptionsRefused: ({ message }) => failConfigWith(describedConfigErrorOf({ message }).text),
    CommandRejected: ({ issue }) => failConfigWith(issue),
  })
