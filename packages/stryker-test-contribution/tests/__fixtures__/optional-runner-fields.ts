export interface OptionalRunnerFields {
  killedBy?: string[]
  coveredBy?: string[]
}

export const optionalRunnerFields = (killedBy?: string[], coveredBy?: string[]): OptionalRunnerFields => {
  const fields: OptionalRunnerFields = {}
  if (killedBy !== undefined) {
    fields.killedBy = killedBy
  }
  if (coveredBy !== undefined) {
    fields.coveredBy = coveredBy
  }
  return fields
}
