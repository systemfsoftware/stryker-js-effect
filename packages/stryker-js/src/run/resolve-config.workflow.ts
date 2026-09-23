import { Workflow } from '@systemfsoftware/effect-cell-types'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import { StrykerOptionsSchema } from '@systemfsoftware/stryker-js-plugin-interface'
import { mergeConfig } from '../config/merge-config.js'

const LoadConfigDecisionTypeId: unique symbol = Symbol.for('@systemfsoftware/stryker-js/LoadConfigDecision')
type LoadConfigDecisionTypeId = typeof LoadConfigDecisionTypeId

export class ConfigFromFile extends S.TaggedClass<ConfigFromFile>()('ConfigFromFile', {
  options: StrykerOptionsSchema,
}) {
  readonly [LoadConfigDecisionTypeId] = LoadConfigDecisionTypeId
  static readonly [Workflow.InstrumentationBrand] = {} as const
}

export class ConfigFromDefaults extends S.TaggedClass<ConfigFromDefaults>()('ConfigFromDefaults', {
  options: StrykerOptionsSchema,
}) {
  readonly [LoadConfigDecisionTypeId] = LoadConfigDecisionTypeId
  static readonly [Workflow.InstrumentationBrand] = {} as const
}

export class LoadConfigRefused extends S.TaggedError<LoadConfigRefused>()('LoadConfigRefused', {
  message: S.String,
}) {}

export type LoadConfigDecision = ConfigFromFile | ConfigFromDefaults

export class LoadConfigCommand extends S.TaggedClass<LoadConfigCommand>()('LoadConfigCommand', {
  cliOptions: S.Record(S.String, S.Unknown),
  fileOptions: S.optional(S.Record(S.String, S.Unknown)),
}) {
  static readonly [Workflow.InstrumentationBrand] = {} as const
}

const decidedFromOf = (
  fileOptions: Record<string, unknown> | undefined,
  options: typeof StrykerOptionsSchema.Type,
) =>
  Match.value(fileOptions).pipe(
    Match.when(undefined, () => ConfigFromDefaults.make({ options })),
    Match.orElse(() => ConfigFromFile.make({ options })),
  )

const fileOptionsOf = (command: typeof LoadConfigCommand.Type) =>
  Option.getOrElse(Option.fromUndefinedOr(command.fileOptions), () => ({}))

export const resolveConfig = Workflow.make({
  command: LoadConfigCommand,
  decision: S.Union([ConfigFromFile, ConfigFromDefaults]),
  error: LoadConfigRefused,
  decide: (command) =>
    Result.mapError(
      S.decodeUnknownResult(StrykerOptionsSchema)(
        mergeConfig(fileOptionsOf(command), command.cliOptions),
      ),
      (failure) => LoadConfigRefused.make({ message: failure.message }),
    ).pipe(
      Result.map((options) => decidedFromOf(command.fileOptions, options)),
    ),
})
