import { Workflow } from '@systemfsoftware/effect-cell-types'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

const ConfigImportFailureDecisionTypeId: unique symbol = Symbol.for(
  '@systemfsoftware/stryker-js/ConfigImportFailureDecision',
)
type ConfigImportFailureDecisionTypeId = typeof ConfigImportFailureDecisionTypeId

export const ConfigImportFailureCode = S.Literals([
  'ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX',
  'ERR_UNKNOWN_FILE_EXTENSION',
  'ERR_MODULE_NOT_FOUND',
  'ERR_PACKAGE_PATH_NOT_EXPORTED',
])
export type ConfigImportFailureCode = typeof ConfigImportFailureCode.Type

export const ConfigImportCodedFailure = S.Struct({ code: ConfigImportFailureCode })

export class ClassifyConfigImportCommand
  extends S.TaggedClass<ClassifyConfigImportCommand, { readonly brand: unique symbol }>()(
    'ClassifyConfigImportCommand',
    {
      file: S.String,
      cause: S.Unknown,
    },
  )
{
  static readonly [Workflow.InstrumentationBrand] = {} as const
}

export class ConfigImportClassified
  extends S.TaggedClass<ConfigImportClassified, { readonly brand: unique symbol }>()('ConfigImportClassified', {
    code: ConfigImportFailureCode,
    file: S.String,
    nodeDetail: S.String,
  })
{
  readonly [ConfigImportFailureDecisionTypeId] = ConfigImportFailureDecisionTypeId
}

export class ConfigImportUnclassified
  extends S.TaggedClass<ConfigImportUnclassified, { readonly brand: unique symbol }>()('ConfigImportUnclassified', {})
{
  readonly [ConfigImportFailureDecisionTypeId] = ConfigImportFailureDecisionTypeId
}

export type ConfigImportFailureDecision = ConfigImportClassified | ConfigImportUnclassified

const thrownErrorOf = <A>(cause: A): Option.Option<Error> => S.decodeUnknownOption(S.instanceOf(Error))(cause)

const knownCodeOf = (error: Error): Option.Option<ConfigImportFailureCode> =>
  Option.map(S.decodeUnknownOption(ConfigImportCodedFailure)(error), (coded) => coded.code)

const classifiedOf = (command: ClassifyConfigImportCommand) => (error: Error): Option.Option<ConfigImportClassified> =>
  Option.map(
    knownCodeOf(error),
    (code) => ConfigImportClassified.make({ code, file: command.file, nodeDetail: error.message }),
  )

const decisionOf = (command: ClassifyConfigImportCommand): ConfigImportFailureDecision =>
  Option.getOrElse(
    Option.flatMap(thrownErrorOf(command.cause), classifiedOf(command)),
    (): ConfigImportFailureDecision => ConfigImportUnclassified.make({}),
  )

export const classifyConfigImportFailure = Workflow.make({
  command: ClassifyConfigImportCommand,
  decision: S.Union([ConfigImportClassified, ConfigImportUnclassified]),
  error: S.Never,
  decide: (command: ClassifyConfigImportCommand) => Result.succeed(decisionOf(command)),
})
