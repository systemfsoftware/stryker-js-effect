import * as S from 'effect/Schema'

export const ExitCode = S.Int.pipe(S.check(S.isBetween({ minimum: 0, maximum: 255 })))
