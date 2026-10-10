import { Workflow } from '@systemfsoftware/effect-cell-types'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import { SupportedConfigFileExtensions } from '../Config.schema.js'

const ConfigModuleFailureDecisionTypeId: unique symbol = Symbol.for(
  '@systemfsoftware/stryker-js/ConfigModuleFailureDecision',
)
type ConfigModuleFailureDecisionTypeId = typeof ConfigModuleFailureDecisionTypeId

export class DescribeConfigImportCommand extends S.TaggedClass<DescribeConfigImportCommand>()(
  'DescribeConfigImportCommand',
  {
    file: S.String,
    message: S.String,
    cause: S.Unknown,
  },
) {
  static readonly [Workflow.InstrumentationBrand] = {} as const
}

export class ConfigImportDescribed extends S.TaggedClass<ConfigImportDescribed>()('ConfigImportDescribed', {
  code: S.String,
  message: S.String,
}) {
  readonly [ConfigModuleFailureDecisionTypeId] = ConfigModuleFailureDecisionTypeId
}

export class ConfigImportUnclassified
  extends S.TaggedClass<ConfigImportUnclassified>()('ConfigImportUnclassified', {})
{
  readonly [ConfigModuleFailureDecisionTypeId] = ConfigModuleFailureDecisionTypeId
}

export type ConfigModuleFailureDecision = ConfigImportDescribed | ConfigImportUnclassified

const SUPPORTED_CONFIG_FILE_EXTENSION_GUIDE = `one of these extensions: ${
  SupportedConfigFileExtensions.literals.map((extension) => `.${extension}`).join(', ')
}`

const ERASABLE_SYNTAX_HELP =
  'Config modules may use only erasable TypeScript syntax: no enums, no namespaces with runtime code, no parameter properties, and no decorators.'

const thrownErrorOf = <A>(cause: A): Option.Option<Error> =>
  Option.map(S.decodeUnknownOption(S.instanceOf(Error))(cause), (error) => error)

const stringCodeOf = (error: Error): Option.Option<string> =>
  Option.map(S.decodeUnknownOption(S.Struct({ code: S.String }))(error), (coded) => coded.code)

const errorCodeOf = <A>(cause: A): string | undefined =>
  Option.getOrUndefined(Option.flatMap(thrownErrorOf(cause), stringCodeOf))

const errorMessageOf = <A>(cause: A): string | undefined =>
  Option.getOrUndefined(Option.map(thrownErrorOf(cause), (error) => error.message))

const importFailureDetailOf = (command: DescribeConfigImportCommand): string =>
  Option.getOrElse(Option.fromUndefinedOr(errorMessageOf(command.cause)), () => command.message)

const unloadableOf = (file: string, code: string, message: string): ConfigImportDescribed =>
  ConfigImportDescribed.make({ code, message })

const importDecisionOf = (command: DescribeConfigImportCommand): ConfigModuleFailureDecision =>
  Match.value(errorCodeOf(command.cause)).pipe(
    Match.when(
      'ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX',
      (code) =>
        unloadableOf(
          command.file,
          code,
          `The config file "${command.file}" uses TypeScript syntax Node cannot execute. ${ERASABLE_SYNTAX_HELP}`,
        ),
    ),
    Match.when(
      'ERR_UNKNOWN_FILE_EXTENSION',
      (code) =>
        unloadableOf(
          command.file,
          code,
          `The config file "${command.file}" has an extension Node cannot load. Stryker reads config modules with ${SUPPORTED_CONFIG_FILE_EXTENSION_GUIDE}.`,
        ),
    ),
    Match.when(
      'ERR_MODULE_NOT_FOUND',
      (code) =>
        unloadableOf(
          command.file,
          code,
          `The config file "${command.file}" imports a module Node cannot find. The specifier is most likely not installed — install it as a dependency of the project, or remove the import. Node reported: ${
            importFailureDetailOf(command)
          }`,
        ),
    ),
    Match.when(
      'ERR_PACKAGE_PATH_NOT_EXPORTED',
      (code) =>
        unloadableOf(
          command.file,
          code,
          `The config file "${command.file}" imports a path a package does not export. The package is installed but its "exports" map leaves this specifier out — import a path the package publishes. Node reported: ${
            importFailureDetailOf(command)
          }`,
        ),
    ),
    Match.orElse(() => ConfigImportUnclassified.make({})),
  )

export const describeConfigModuleFailure = Workflow.make({
  command: DescribeConfigImportCommand,
  decision: S.Union([ConfigImportDescribed, ConfigImportUnclassified]),
  error: S.Never,
  decide: (command: DescribeConfigImportCommand) => Result.succeed(importDecisionOf(command)),
})
