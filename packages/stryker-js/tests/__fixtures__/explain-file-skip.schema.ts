import * as S from 'effect/Schema'

export const ExtensionShape = S.Union([
  S.Literal('.html'),
  S.Literal('.htm'),
  S.Literal('.vue'),
  S.Literal('.svelte'),
  S.Literal('.txt'),
])

const ClaimantPackage = S.Union([
  S.Literal('@f/angular'),
  S.Literal('@f/svelte'),
  S.Literal('@f/other'),
])

export const SoloCase = S.Struct({
  extension: ExtensionShape,
  owner: ClaimantPackage,
  decoyExtensions: S.optional(S.Literal('.png')),
})

export const StrangerCase = S.Struct({
  extension: ExtensionShape,
  strangers: S.NonEmptyArray(S.Struct({ package: ClaimantPackage, decoy: ExtensionShape })),
})

export const CrowdCase = S.Struct({
  extension: ExtensionShape,
  first: ClaimantPackage,
  second: ClaimantPackage,
  last: ClaimantPackage,
  sleeper: ClaimantPackage,
})
