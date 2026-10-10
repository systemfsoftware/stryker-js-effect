import { Workflow } from '@systemfsoftware/effect-cell-types'
import { Options } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Boolean from 'effect/Boolean'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import { ConfigDocumentSchema } from '../Config.schema.js'

const LoadConfigDecisionTypeId: unique symbol = Symbol.for('@systemfsoftware/stryker-js/LoadConfigDecision')
type LoadConfigDecisionTypeId = typeof LoadConfigDecisionTypeId

const DecodedOptions = S.toType(Options.StrykerOptionsSchema)

export class ConfigOptionsRefused extends S.TaggedError<ConfigOptionsRefused>()('ConfigOptionsRefused', {
  message: S.String,
}) {}

export class ConfigFromFile extends S.TaggedClass<ConfigFromFile>()('ConfigFromFile', {
  options: DecodedOptions,
}) {
  readonly [LoadConfigDecisionTypeId] = LoadConfigDecisionTypeId
  static readonly [Workflow.InstrumentationBrand] = {} as const
}

export class ConfigFromDefaults extends S.TaggedClass<ConfigFromDefaults>()('ConfigFromDefaults', {
  options: DecodedOptions,
}) {
  readonly [LoadConfigDecisionTypeId] = LoadConfigDecisionTypeId
  static readonly [Workflow.InstrumentationBrand] = {} as const
}

export type LoadConfigDecision = ConfigFromFile | ConfigFromDefaults

export class LoadConfigCommand extends S.TaggedClass<LoadConfigCommand>()('LoadConfigCommand', {
  document: ConfigDocumentSchema,
  fileFound: S.Boolean,
}) {
  static readonly [Workflow.InstrumentationBrand] = {} as const
}

const decodeOptions = S.decodeResult(Options.StrykerOptionsSchema)

const decidedFromOf = (fileFound: boolean, options: Options.StrykerOptions) =>
  Boolean.match(fileFound, {
    onTrue: () => ConfigFromFile.make({ options }),
    onFalse: () => ConfigFromDefaults.make({ options }),
  })

export const resolveConfig = Workflow.make({
  command: LoadConfigCommand,
  decision: S.Union([ConfigFromFile, ConfigFromDefaults]),
  error: ConfigOptionsRefused,
  decide: (command) =>
    Result.match(decodeOptions(command.document), {
      onSuccess: (options) => Result.succeed(decidedFromOf(command.fileFound, options)),
      onFailure: (failure) => Result.fail(ConfigOptionsRefused.make({ message: failure.message })),
    }),
})
