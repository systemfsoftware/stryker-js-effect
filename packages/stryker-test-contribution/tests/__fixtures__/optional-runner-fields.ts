import { TestRunner } from '@systemfsoftware/stryker-js-plugin-interface'
import { dual } from 'effect/Function'

export interface OptionalRunnerFields {
  killedBy?: TestRunner.TestId[]
  coveredBy?: TestRunner.TestId[]
}

export const optionalRunnerFields: {
  (killedBy: string[] | undefined, coveredBy: string[] | undefined): OptionalRunnerFields
  (coveredBy: string[] | undefined): (killedBy: string[] | undefined) => OptionalRunnerFields
} = dual(
  2,
  (killedBy: string[] | undefined, coveredBy: string[] | undefined): OptionalRunnerFields => {
    const fields: OptionalRunnerFields = {}
    if (killedBy !== undefined) {
      fields.killedBy = killedBy.map((id) => TestRunner.TestId.make(id))
    }
    if (coveredBy !== undefined) {
      fields.coveredBy = coveredBy.map((id) => TestRunner.TestId.make(id))
    }
    return fields
  },
)
