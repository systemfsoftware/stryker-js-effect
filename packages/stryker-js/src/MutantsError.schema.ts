import { Schema as S } from 'effect'

export class UnknownPlannedMutant extends S.TaggedError<UnknownPlannedMutant>()('UnknownPlannedMutant', {
  mutantId: S.String,
  message: S.String,
}) {}
