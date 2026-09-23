import { Workflow } from '@systemfsoftware/effect-cell-types'
import * as Match from 'effect/Match'
import * as S from 'effect/Schema'

const LoadConfigDecisionTypeId: unique symbol = Symbol.for('@systemfsoftware/stryker-js/LoadConfigDecision')
type LoadConfigDecisionTypeId = typeof LoadConfigDecisionTypeId

export class ConfigFromFile extends S.TaggedClass<ConfigFromFile>()('ConfigFromFile', {
  document: S.Record(S.String, S.Unknown),
}) {
  readonly [LoadConfigDecisionTypeId] = LoadConfigDecisionTypeId
  static readonly [Workflow.InstrumentationBrand] = {} as const
}

export class ConfigFromDefaults extends S.TaggedClass<ConfigFromDefaults>()('ConfigFromDefaults', {
  document: S.Record(S.String, S.Unknown),
}) {
  readonly [LoadConfigDecisionTypeId] = LoadConfigDecisionTypeId
  static readonly [Workflow.InstrumentationBrand] = {} as const
}

export type LoadConfigDecision = ConfigFromFile | ConfigFromDefaults

export class LoadConfigCommand extends S.TaggedClass<LoadConfigCommand>()('LoadConfigCommand', {
  document: S.Record(S.String, S.Unknown),
  fileFound: S.Boolean,
}) {
  static readonly [Workflow.InstrumentationBrand] = {} as const
}

const decidedFromOf = <A = unknown>(fileFound: boolean, document: Record<string, A>) =>
  Match.value(fileFound).pipe(
    Match.when(true, () => ConfigFromFile.make({ document })),
    Match.orElse(() => ConfigFromDefaults.make({ document })),
  )

export const resolveConfig = Workflow.make({
  command: LoadConfigCommand,
  decision: S.Union([ConfigFromFile, ConfigFromDefaults]),
  error: S.Never,
  decide: (command) => Result.succeed(decidedFromOf(command.fileFound, command.document)),
})
