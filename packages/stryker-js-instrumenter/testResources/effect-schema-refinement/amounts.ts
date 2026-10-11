import * as S from 'effect/Schema'

export const positiveAmount = () => S.Number.check(S.isGreaterThan(0))

export const pairCode = () => S.String.check(S.isMinLength(2))

export const wholeCount = () => S.Number.check(S.isInt())
