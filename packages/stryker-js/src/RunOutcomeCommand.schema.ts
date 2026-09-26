import { Workflow } from '@systemfsoftware/effect-cell-types'
import { Plugin, Report } from '@systemfsoftware/stryker-js-plugin-interface'
import * as S from 'effect/Schema'

export const RunSucceededClean = S.TaggedStruct('RunSucceededClean', {})

export const RunSucceededVerdict = S.TaggedStruct('RunSucceededVerdict', {
  exitClass: Plugin.ExitClass,
  diagnostic: S.NullOr(S.String),
})

export const RunInterruptedObservation = S.TaggedStruct('RunInterruptedObservation', {})

export const RunHelpObservation = S.TaggedStruct('RunHelpObservation', {
  errorCount: Report.NonNegativeInt,
  unrecognized: S.NullOr(S.String),
})

export const RunCliErrorObservation = S.TaggedStruct('RunCliErrorObservation', {
  unrecognized: S.NullOr(S.String),
})

export const RunSurvivorsRejectedObservation = S.TaggedStruct('RunSurvivorsRejectedObservation', {
  reason: S.Literals(['no-report', 'mismatch']),
  diagnostic: S.NullOr(S.String),
})

export const RunSchemaErrorObservation = S.TaggedStruct('RunSchemaErrorObservation', {
  configDetail: S.NullOr(S.String),
})

export const RunClassedObservation = S.TaggedStruct('RunClassedObservation', {
  exitClass: Plugin.ExitClass,
  configDetail: S.NullOr(S.String),
  diagnostic: S.NullOr(S.String),
})

export const RunGenericFailureObservation = S.TaggedStruct('RunGenericFailureObservation', {
  diagnostic: S.NullOr(S.String),
})

export const RunOutcomeObservation = S.Union([
  RunSucceededClean,
  RunSucceededVerdict,
  RunInterruptedObservation,
  RunHelpObservation,
  RunCliErrorObservation,
  RunSurvivorsRejectedObservation,
  RunSchemaErrorObservation,
  RunClassedObservation,
  RunGenericFailureObservation,
])
export type RunOutcomeObservation = typeof RunOutcomeObservation.Type

export type RunSucceededVerdict = typeof RunSucceededVerdict.Type
export type RunHelpObservation = typeof RunHelpObservation.Type
export type RunCliErrorObservation = typeof RunCliErrorObservation.Type
export type RunSurvivorsRejectedObservation = typeof RunSurvivorsRejectedObservation.Type
export type RunSchemaErrorObservation = typeof RunSchemaErrorObservation.Type
export type RunClassedObservation = typeof RunClassedObservation.Type
export type RunGenericFailureObservation = typeof RunGenericFailureObservation.Type

export class RunOutcomeCommand extends S.TaggedClass<RunOutcomeCommand>()('RunOutcomeCommand', {
  observation: RunOutcomeObservation,
}) {
  static readonly [Workflow.InstrumentationBrand] = {} as const
}
