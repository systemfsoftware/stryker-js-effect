import { MutantActivationSchema } from '@systemfsoftware/stryker-js-instrumenter'
import * as S from 'effect/Schema'

export const PlannedMutantRunOptions = S.Struct({
  mutantActivation: MutantActivationSchema,
  timeout: S.Finite,
  sandboxFileName: S.String,
  disableBail: S.Boolean,
  reloadEnvironment: S.Boolean,
  testFilter: S.String.pipe(S.Array, S.optional),
  hitLimit: S.optional(S.Finite),
})
