import { Mutant, Options } from '@systemfsoftware/stryker-js-plugin-interface'
import * as S from 'effect/Schema'

import { PlacementWaiver } from '@systemfsoftware/stryker-e2e-core'

export const PlacementSlice = S.Struct({
  id: S.NonEmptyString,
  fixtureDir: S.NonEmptyString,
  mutateFiles: S.NonEmptyArray(S.NonEmptyString),
  packageGlobs: S.Array(S.String),
  excludedMutations: S.Array(Mutant.MutatorName),
  optInMutations: S.Array(Mutant.MutatorName),
  providerModules: S.Array(S.String),
  coverageAnalysis: Options.CoverageAnalysisMode,
  waivers: S.Array(PlacementWaiver),
})
export type PlacementSlice = typeof PlacementSlice.Type
export type PlacementSliceEncoded = typeof PlacementSlice.Encoded
