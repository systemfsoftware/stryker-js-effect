import { Sandwich } from '@systemfsoftware/effect-cell-types'
import { Options } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Config from 'effect/Config'
import * as Effect from 'effect/Effect'
import type * as FileSystem from 'effect/FileSystem'
import { dual } from 'effect/Function'
import type * as Path from 'effect/Path'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import { type OutputMode, SpanTaxonomy } from '@systemfsoftware/stryker-js-cli-contract'
import { forkOptionsSchema } from '../Config.schema.js'
import type { ConfigEnv, ConfigOverlay } from '../config/stryker-config.schema.js'
import { ConfigError } from '../ConfigError.schema.js'
import { type ConfigReadError, readConfigDocument } from '../drivers/config.js'
import { describeConfigError, DescribeConfigErrorCommand } from './describe-config-error.workflow.js'
import { LoadConfigCommand, resolveConfig } from './resolve-config.workflow.js'
import { phaseEntered } from './RunEnvironment.service.js'

export type { ConfigReadError } from '../drivers/config.js'
export type { ValidationSchemaDocument } from './validate-options-admission.workflow.js'

export interface ConfigInvocation {
  readonly command: 'run' | 'merge'
  readonly mode: OutputMode.OutputMode
  readonly overlay: ConfigOverlay
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
  readonly command: 'run' | 'merge'
  readonly mode: OutputMode.OutputMode
  readonly isDryRun: boolean
}): Effect.Effect<ConfigEnv> =>
  Effect.map(isCiEnvironment, (isCi) => ({
    command: input.command,
    mode: input.mode,
    isDryRun: input.isDryRun,
    isCi,
  }))

export const forkCoreSchema = S.toJsonSchemaDocument(forkOptionsSchema).schema

export const describedConfigErrorOf = (input: {
  readonly message?: string | undefined
  readonly errors?: readonly string[] | undefined
}) =>
  Result.getOrElse(
    describeConfigError(DescribeConfigErrorCommand.make({ message: input.message, errors: input.errors })),
    (neverError) => neverError,
  )

export const describeErrors = (error: S.SchemaError): readonly string[] =>
  describedConfigErrorOf({ message: error.message }).errors

export const emitPreparePhaseEntered = phaseEntered('prepare')

export const failConfigWith = (message: string) =>
  Effect.fail(ConfigError.make({ message })).pipe(Effect.tapCause(() => emitPreparePhaseEntered))

export const readLoadConfig = Effect.fn(SpanTaxonomy.Spans.configLoad.name)(function*(input: {
  readonly cliOptions: Options.PartialStrykerOptions
  readonly invocation: ConfigInvocation
}) {
  const configEnv = yield* configEnvOf({
    command: input.invocation.command,
    mode: input.invocation.mode,
    isDryRun: input.cliOptions['dryRunOnly'] === true,
  })
  const loaded = yield* readConfigDocument({
    cliOptions: input.cliOptions,
    configEnv,
    overlay: input.invocation.overlay,
  })
  const command: typeof LoadConfigCommand.Encoded = {
    _tag: 'LoadConfigCommand',
    document: loaded.document,
    fileFound: loaded.fileFound,
  }
  return command
})

export const loadConfig = Sandwich.named(SpanTaxonomy.Spans.configRead.name)(readLoadConfig)
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
