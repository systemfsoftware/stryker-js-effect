import * as S from 'effect/Schema'

export const LoadedConfigSchema = S.Struct({
  testRunner: S.String,
  baseConcurrency: S.Finite,
  factoryConcurrency: S.Finite,
  promisedConcurrency: S.Finite,
  mergedConcurrency: S.Finite,
  mergedLow: S.Finite,
  mergedHigh: S.Finite,
})
