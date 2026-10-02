import { Workflow } from '@systemfsoftware/effect-cell-types'
import { FailureRecord } from '@systemfsoftware/stryker-js-cli-contract'
import { Plugin } from '@systemfsoftware/stryker-js-plugin-interface'
import * as S from 'effect/Schema'

export const RunSucceededClean = S.TaggedStruct('RunSucceededClean', {})

export const RunSucceededVerdict = S.TaggedStruct('RunSucceededVerdict', {
  exitClass: Plugin.ExitClass,
})

export const RunHelpObservation = S.TaggedStruct('RunHelpObservation', {})

export const ObservedFailure = S.Struct({
  record: FailureRecord.FailureRecord,
  exitCode: Plugin.ExitCode,
})
export type ObservedFailure = typeof ObservedFailure.Type

export const RunFailedObservation = S.TaggedStruct('RunFailedObservation', {
  failures: S.NonEmptyArray(ObservedFailure),
})

export const RunOutcomeObservation = S.Union([
  RunSucceededClean,
  RunSucceededVerdict,
  RunHelpObservation,
  RunFailedObservation,
])
export type RunOutcomeObservation = typeof RunOutcomeObservation.Type

export type RunSucceededVerdict = typeof RunSucceededVerdict.Type
export type RunFailedObservation = typeof RunFailedObservation.Type

export class RunOutcomeCommand extends S.TaggedClass<RunOutcomeCommand>()('RunOutcomeCommand', {
  observation: RunOutcomeObservation,
}) {
  static readonly [Workflow.InstrumentationBrand] = {} as const
}
