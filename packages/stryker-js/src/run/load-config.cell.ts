import { Sandwich } from '@systemfsoftware/effect-cell-types'
import { Options } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Config from 'effect/Config'
import * as Effect from 'effect/Effect'
import type * as FileSystem from 'effect/FileSystem'
import { dual } from 'effect/Function'
import type * as Path from 'effect/Path'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import { forkOptionsSchema } from '../Config.schema.js'
import type { ConfigEnv } from '../config/stryker-config.schema.js'
import { ConfigError } from '../ConfigError.schema.js'
import { type ConfigReadError, readConfigDocument } from '../drivers/config.js'
import type { OutputMode } from '../output-mode.schema.js'
import { describeConfigError, DescribeConfigErrorCommand } from './describe-config-error.workflow.js'
import { LoadConfigCommand, resolveConfig } from './resolve-config.workflow.js'
import { phaseEntered, RunEnvironment } from './RunEnvironment.service.js'
import {
  validateOptionsAdmission,
  ValidateOptionsCommand,
  type ValidationSchemaDocument,
} from './validate-options-admission.workflow.js'

export type { ConfigReadError } from '../drivers/config.js'
export type { ValidationSchemaDocument } from './validate-options-admission.workflow.js'

export interface ConfigInvocation {
  readonly command: 'run' | 'merge-reports'
  readonly mode: OutputMode
}

export interface LoadedConfig {
  readonly options: Options.StrykerOptions
  readonly basePath: string
}

const isCiValue = (value: string): boolean => ['', '0', 'false'].includes(value.trim().toLowerCase()) === false

const isCiEnvironment: Effect.Effect<boolean> = Config.String('CI').pipe(
  Effect.map(isCiValue),
  Effect.orElseSucceed(() => false),
)

export const configEnvOf = (input: {
  readonly command: 'run' | 'merge-reports'
  readonly mode: OutputMode
  readonly isDryRun: boolean
}): Effect.Effect<ConfigEnv> =>
  Effect.map(isCiEnvironment, (isCi) => ({
    command: input.command,
    mode: input.mode,
    isDryRun: input.isDryRun,
    isCi,
  }))

export const forkCoreSchema = S.toJsonSchemaDocument(forkOptionsSchema).schema

const describedConfigErrorOf = (input: {
  readonly message?: string | undefined
  readonly errors?: readonly string[] | undefined
}) =>
  Result.getOrElse(
    describeConfigError(DescribeConfigErrorCommand.make({ message: input.message, errors: input.errors })),
    (neverError) => neverError,
  )

export const describeErrors = (error: S.SchemaError): readonly string[] =>
  describedConfigErrorOf({ message: error.message }).errors

const emitPreparePhaseEntered = phaseEntered('prepare')

const failConfigWith = (message: string) =>
  Effect.fail(ConfigError.make({ message })).pipe(Effect.tapCause(() => emitPreparePhaseEntered))

const readLoadConfig = Effect.fn('stryker.config.load')(function*(input: {
  readonly cliOptions: Options.PartialStrykerOptions
  readonly invocation: ConfigInvocation
}) {
  const configEnv = yield* configEnvOf({
    command: input.invocation.command,
    mode: input.invocation.mode,
    isDryRun: input.cliOptions['dryRunOnly'] === true,
  })
  const loaded = yield* readConfigDocument({ cliOptions: input.cliOptions, configEnv })
  const command: typeof LoadConfigCommand.Encoded = {
    _tag: 'LoadConfigCommand',
    document: loaded.document,
    fileFound: loaded.fileFound,
  }
  return command
})

const readRunConfig = Effect.fn('stryker.config.readRun')(function*(input: {
  readonly cliOptions: Options.PartialStrykerOptions
  readonly targetMutatePatterns: readonly string[] | undefined
}) {
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

export const loadConfig = Sandwich.named('stryker.config_read')(readLoadConfig)
  .decide(resolveConfig)
  .write({
    ConfigFromFile: ({ options }) => Effect.succeed(options),
    ConfigFromDefaults: ({ options }) => Effect.succeed(options),
    ConfigOptionsRefused: ({ message }) =>
      Effect.fail(ConfigError.make({ message: describedConfigErrorOf({ message }).text })),
    CommandRejected: ({ issue }) => Effect.fail(ConfigError.make({ message: issue })),
  })

export const readConfig: {
  (
    invocation: ConfigInvocation,
  ): (
    cliOptions: Options.PartialStrykerOptions,
  ) => Effect.Effect<
    Options.StrykerOptions,
    ConfigReadError,
    FileSystem.FileSystem | Path.Path
  >
  (
    cliOptions: Options.PartialStrykerOptions,
    invocation: ConfigInvocation,
  ): Effect.Effect<
    Options.StrykerOptions,
    ConfigReadError,
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
    ConfigOptionsRefused: ({ message }) => failConfigWith(describedConfigErrorOf({ message }).text),
    CommandRejected: ({ issue }) => failConfigWith(issue),
  })

const readValidateOptions = (command: ValidateOptionsCommand) => Effect.succeed(command)

export const validateOptionsCell = Sandwich.named('stryker.validate_options')(readValidateOptions)
  .decide(validateOptionsAdmission)
  .write({
    OptionsValidated: ({ options, warnings }) =>
      Effect.forEach(warnings, (warning) => Effect.logWarning(warning), { discard: true }).pipe(Effect.as(options)),
    OptionsRefused: ({ errors, warnings }) =>
      Effect.forEach(warnings, (warning) => Effect.logWarning(warning), { discard: true }).pipe(
        Effect.flatMap(() => Effect.forEach(errors, (error) => Effect.logError(error), { discard: true })),
        Effect.flatMap(() => Effect.fail(ConfigError.make({ message: describedConfigErrorOf({ errors }).text }))),
      ),
    OptionsUndecodable: ({ message, warnings }) => {
      const described = describedConfigErrorOf({ message })
      return Effect.forEach(warnings, (warning) => Effect.logWarning(warning), { discard: true }).pipe(
        Effect.flatMap(() => Effect.forEach(described.errors, (error) => Effect.logError(error), { discard: true })),
        Effect.flatMap(() => Effect.fail(ConfigError.make({ message: described.text }))),
      )
    },
    CommandRejected: ({ issue }) => Effect.fail(ConfigError.make({ message: issue })),
  })

export const validateOptions = dual<
  <A = unknown>(
    schema: ValidationSchemaDocument,
  ) => (options: Record<string, A>) => Effect.Effect<Options.StrykerOptions, ConfigError>,
  <A = unknown>(
    options: Record<string, A>,
    schema: ValidationSchemaDocument,
  ) => Effect.Effect<Options.StrykerOptions, ConfigError>
>(2, (options, schema) => validateOptionsCell.run(ValidateOptionsCommand.make({ options, schema })))
