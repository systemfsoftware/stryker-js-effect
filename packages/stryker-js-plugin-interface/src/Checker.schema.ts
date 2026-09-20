import * as S from 'effect/Schema'

/** A position inside a file, in the coordinates the wire carries — 0-based line and column. */
export const CheckerPositionWire = S.Struct({
  line: S.Finite,
  column: S.Finite,
})
export type CheckerPositionWire = typeof CheckerPositionWire.Type

export const CheckerLocationWire = S.Struct({
  start: CheckerPositionWire,
  end: CheckerPositionWire,
})
export type CheckerLocationWire = typeof CheckerLocationWire.Type

export const CheckerMutantWire = S.Struct({
  id: S.NonEmptyString,
  fileName: S.NonEmptyString,
  mutatorName: S.NonEmptyString,
  replacement: S.String,
  location: CheckerLocationWire,
})
export type CheckerMutantWire = typeof CheckerMutantWire.Type

export const CheckStatus = S.Literals(['passed', 'compileError'])
export type CheckStatus = typeof CheckStatus.Type

export const CheckResultSchema = S.Union([
  S.Struct({ status: S.Literal('passed') }),
  S.Struct({ status: S.Literal('compileError'), reason: S.String }),
])

export class CheckerFailed extends S.TaggedError<CheckerFailed>()('CheckerFailed', {
  cause: S.String,
  checkerName: S.String,
  mutantIds: S.Array(S.String),
}) {}
