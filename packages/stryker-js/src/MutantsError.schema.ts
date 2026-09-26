import { Mutant } from '@systemfsoftware/stryker-js-instrumenter'
import { Schema as S } from 'effect'

export class UnknownPlannedMutant extends S.TaggedError<UnknownPlannedMutant>()('UnknownPlannedMutant', {
  mutantId: Mutant.MutantId,
  message: S.String,
}) {}
