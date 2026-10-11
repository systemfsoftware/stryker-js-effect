import * as S from 'effect/Schema'

// @stryker-expect next-line KilledOrTimeout: RefinementBoundary, RefinementRemoval
export const PositiveAmount = S.Finite.check(S.isGreaterThan(0))

// @stryker-expect next-line KilledOrTimeout: RefinementBoundary, RefinementRemoval, Regex
export const PairCode = S.String.check(S.isMinLength(2), S.isPattern(/^[A-Z]+$/u))
