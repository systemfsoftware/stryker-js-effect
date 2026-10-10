import * as S from 'effect/Schema'

export const SatisfiedCall = S.Union([
  S.TaggedStruct('NotACallArgument', {}),
  S.TaggedStruct('CallArgument', { signatureCount: S.Literal(1), declaredGeneric: S.Literal(false) }),
])

export const AssignableQueryInput = S.Struct({
  candidateType: S.String,
  assignable: S.Boolean,
  contextualTypeText: S.String,
  call: SatisfiedCall,
})
export type AssignableQueryInput = typeof AssignableQueryInput.Type
