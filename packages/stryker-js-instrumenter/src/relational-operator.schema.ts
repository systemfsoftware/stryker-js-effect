import * as S from 'effect/Schema'

export const RelationalOperator = S.Literals(['<', '<=', '>', '>='])
export type RelationalOperator = typeof RelationalOperator.Type
