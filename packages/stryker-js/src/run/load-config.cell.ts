import { Sandwich } from '@systemfsoftware/effect-cell-types'
import type { Options } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Effect from 'effect/Effect'
import type * as FileSystem from 'effect/FileSystem'
import { dual } from 'effect/Function'
import type * as Path from 'effect/Path'

import {
  ConfigError,
  ConfigFileInvalidError,
  ConfigFileNotFoundError,
  ConfigFileUnreadableError,
  ConfigFileUnsupportedError,
} from '../ConfigError.schema.js'
import {
  configErrorMessage,
  type ConfigInvocation,
  describeMessageOf,
  failConfigWith,
  readLoadConfig,
  readRunConfig,
} from './load-config.parts.js'
import { resolveConfig } from './resolve-config.workflow.js'

export {
  decideExtendsStep,
  describeErrors,
  forkCoreSchema,
  importModule,
  initialExtendsStepState,
  isModuleSpecifier,
  mergeConfigs,
  validateOptions,
} from './load-config.parts.js'
export type { ConfigInvocation, LoadedConfig, ValidationSchemaDocument } from './load-config.parts.js'

export const loadConfig = Sandwich.named('stryker.config_read')(readLoadConfig)
  .decide(resolveConfig)
  .write({
    ConfigFromFile: ({ options }) => Effect.succeed(options),
    ConfigFromDefaults: ({ options }) => Effect.succeed(options),
    ConfigOptionsRefused: ({ message }) =>
      Effect.fail(ConfigError.make({ message: configErrorMessage(describeMessageOf(message)) })),
    CommandRejected: ({ issue }) => Effect.fail(ConfigError.make({ message: issue })),
  })

export const readConfig: {
  (
    invocation: ConfigInvocation,
  ): (
    cliOptions: Options.PartialStrykerOptions,
  ) => Effect.Effect<
    Options.StrykerOptions,
    ConfigFileNotFoundError | ConfigFileUnreadableError | ConfigFileInvalidError | ConfigFileUnsupportedError,
    FileSystem.FileSystem | Path.Path
  >
  (
    cliOptions: Options.PartialStrykerOptions,
    invocation: ConfigInvocation,
  ): Effect.Effect<
    Options.StrykerOptions,
    ConfigFileNotFoundError | ConfigFileUnreadableError | ConfigFileInvalidError | ConfigFileUnsupportedError,
    FileSystem.FileSystem | Path.Path
  >
} = dual(
  2,
  (cliOptions: Options.PartialStrykerOptions, invocation: ConfigInvocation) =>
    loadConfig.run({ cliOptions, invocation }),
)

export const loadConfigCell = Sandwich.named('stryker.load_config')(readRunConfig)
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
    ConfigOptionsRefused: ({ message }) => failConfigWith(configErrorMessage(describeMessageOf(message))),
    CommandRejected: ({ issue }) => failConfigWith(issue),
  })
