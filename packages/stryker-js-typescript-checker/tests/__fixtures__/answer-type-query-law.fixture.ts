import * as S from 'effect/Schema'

export const SatisfiedOrigin = S.Union([
  S.TaggedStruct('DeclaredContext', {}),
  S.TaggedStruct('CallArgument', { signatureCount: S.Literal(1), declaredGeneric: S.Literal(false) }),
])

export const AssignableQueryInput = S.Struct({
  candidateType: S.String,
  assignable: S.Boolean,
  contextualTypeText: S.String,
  origin: SatisfiedOrigin,
})
export type AssignableQueryInput = typeof AssignableQueryInput.Type
