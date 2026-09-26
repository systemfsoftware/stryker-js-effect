import { Mutant } from '@systemfsoftware/stryker-js-instrumenter'
import * as S from 'effect/Schema'

export const CheckerMutantWire = S.Struct({
  id: Mutant.MutantId,
  fileName: Mutant.CanonicalFileName,
  mutatorName: Mutant.MutatorName,
  replacement: S.String,
  location: Mutant.Location,
})
export type CheckerMutantWire = typeof CheckerMutantWire.Type

export const CheckResultSchema = S.Union([
  S.Struct({ status: S.Literal('passed') }),
  S.Struct({ status: S.Literal('compileError'), reason: S.String }),
]).pipe(S.toTaggedUnion('status'))

export const CheckStatus = S.Literals(CheckResultSchema.discriminants)
export type CheckStatus = typeof CheckStatus.Type

export class CheckerFailed extends S.TaggedError<CheckerFailed>()('CheckerFailed', {
  cause: S.String,
  checkerName: S.String,
  mutantIds: S.Array(Mutant.MutantId),
}) {}

export type CheckResult = typeof CheckResultSchema.Type
export type FailedCheckResult = Extract<CheckResult, { readonly status: 'compileError' }>
export type PassedCheckResult = Extract<CheckResult, { readonly status: 'passed' }>
