import {
  Assignable,
  NotAssignable,
  type TypeAnswer as TypeAnswerShape,
  Unknown,
  type UnknownReason,
} from '@systemfsoftware/stryker-js-plugin-interface/type-query'

export type TypeAnswer = TypeAnswerShape

export const unknownAnswer = (reason: UnknownReason): TypeAnswer => Unknown.make({ reason })

export const assignableAnswer = (candidateType: string): TypeAnswer => Assignable.make({ candidateType })

export const notAssignableAnswer = (fields: {
  readonly candidateType: string
  readonly contextualType: string
}): TypeAnswer => NotAssignable.make(fields)
