import { Mutant } from '@systemfsoftware/stryker-js-plugin-interface'
import { Schema as S } from 'effect'

export class UnknownPlannedMutant
  extends S.TaggedError<UnknownPlannedMutant, { readonly brand: unique symbol }>()('UnknownPlannedMutant', {
    mutantId: Mutant.MutantId,
    message: S.String,
  })
{}
