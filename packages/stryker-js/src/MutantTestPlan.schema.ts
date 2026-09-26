import { Mutant } from '@systemfsoftware/stryker-js-instrumenter'
import * as S from 'effect/Schema'

export const PlannedMutantRunOptions = S.Struct({
  mutantActivation: Mutant.MutantActivationSchema,
  ...Mutant.RunOptionsFields,
  sandboxFileName: S.String,
  reloadEnvironment: S.Boolean,
  testFilter: S.String.pipe(S.Array, S.optional),
  hitLimit: S.optional(Mutant.HitCount),
})
