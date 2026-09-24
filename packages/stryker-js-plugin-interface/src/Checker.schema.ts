import { Mutant } from '@systemfsoftware/stryker-js-instrumenter'
import * as S from 'effect/Schema'

export const CheckerMutantWire = S.Struct({
  id: Mutant.MutantId,
  fileName: Mutant.CanonicalFileName,
  mutatorName: Mutant.MutatorName,
  replacement: S.String,
  location: Mutant.LocationSchema,
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

export interface FailedCheckResult {
  readonly reason: string
  readonly status: 'compileError'
}

export interface PassedCheckResult {
  readonly status: 'passed'
}

export type CheckResult = FailedCheckResult | PassedCheckResult
