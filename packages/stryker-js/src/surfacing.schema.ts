import { Mutant, Plugin } from '@systemfsoftware/stryker-js-plugin-interface'
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

export class AnnotationsUnusable
  extends S.TaggedError<AnnotationsUnusable, { readonly brand: unique symbol }>()('AnnotationsUnusable', {
    message: S.String,
  })
{
  readonly exitClass = 'ConfigError' satisfies Plugin.ExitClass
}
