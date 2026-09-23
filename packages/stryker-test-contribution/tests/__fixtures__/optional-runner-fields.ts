import { dual } from 'effect/Function'

export interface OptionalRunnerFields {
  killedBy?: string[]
  coveredBy?: string[]
}

export const optionalRunnerFields: {
  (killedBy: string[] | undefined, coveredBy: string[] | undefined): OptionalRunnerFields
  (coveredBy: string[] | undefined): (killedBy: string[] | undefined) => OptionalRunnerFields
} = dual(
  2,
  (killedBy: string[] | undefined, coveredBy: string[] | undefined): OptionalRunnerFields => {
    const fields: OptionalRunnerFields = {}
    if (killedBy !== undefined) {
      fields.killedBy = killedBy
    }
    if (coveredBy !== undefined) {
      fields.coveredBy = coveredBy
    }
    return fields
  },
)
