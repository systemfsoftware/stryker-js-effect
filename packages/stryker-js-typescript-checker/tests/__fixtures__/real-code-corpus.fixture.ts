import * as S from 'effect/Schema'

export const Recorded = S.Struct({ checks: S.Array(S.String), typeAnswers: S.Array(S.String) })
export type Recorded = typeof Recorded.Type
