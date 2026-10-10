import * as S from 'effect/Schema'

export const AnsiCode = S.Struct({
  red: S.Literal('\u001b[31m'),
  green: S.Literal('\u001b[32m'),
  yellow: S.Literal('\u001b[33m'),
  grey: S.Literal('\u001b[90m'),
  cyan: S.Literal('\u001b[36m'),
  greenBright: S.Literal('\u001b[92m'),
  redBright: S.Literal('\u001b[91m'),
  blueBright: S.Literal('\u001b[94m'),
  reset: S.Literal('\u001b[39m'),
})
export type AnsiCode = typeof AnsiCode.Type

export type AnsiColor = Exclude<keyof AnsiCode, 'reset'>
