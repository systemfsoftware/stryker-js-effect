import * as S from 'effect/Schema'

export const RegistryPins = S.Record(S.String, S.String)
export type RegistryPins = typeof RegistryPins.Type

const Specs = S.optional(S.Record(S.String, S.String))

export const PinnableFields = S.Struct({
  dependencies: Specs,
  devDependencies: Specs,
  optionalDependencies: Specs,
  overrides: Specs,
})
export type PinnableFields = typeof PinnableFields.Type
