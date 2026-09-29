import { Mutant } from '@systemfsoftware/stryker-js-plugin-interface'
import * as S from 'effect/Schema'

export const SurvivorRef = S.Struct({
  id: Mutant.MutantId,
  fileName: S.String,
  line: Mutant.Line,
})

export type SurvivorRef = typeof SurvivorRef.Type

export const SurfacingCaps = S.Struct({
  perLine: S.Natural,
  perFile: S.Natural,
})

export type SurfacingCaps = typeof SurfacingCaps.Type

export const SurfacingFields = S.Struct({
  perLine: S.optional(S.Natural),
  perFile: S.optional(S.Natural),
})

export type SurfacingFields = typeof SurfacingFields.Type
