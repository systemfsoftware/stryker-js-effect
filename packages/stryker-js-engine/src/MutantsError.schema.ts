import { Mutant } from '@systemfsoftware/stryker-js-plugin-interface'
import { Schema as S } from 'effect'

export class UnknownPlannedMutant extends S.TaggedError<UnknownPlannedMutant>()('UnknownPlannedMutant', {
  mutantId: Mutant.MutantId,
  message: S.String,
}) {}
