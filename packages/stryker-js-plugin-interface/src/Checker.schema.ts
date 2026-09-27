import * as S from 'effect/Schema'

import { Location } from './Location.schema.js'
import { CanonicalFileName, MutantId, MutatorName } from './Mutant.schema.js'

export const CheckerMutantWire = S.Struct({
  id: MutantId,
  fileName: CanonicalFileName,
  mutatorName: MutatorName,
  replacement: S.String,
  location: Location,
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
  mutantIds: S.Array(MutantId),
}) {
  override get message(): string {
    const mutants = this.mutantIds.length === 0 ? '' : ` for mutants ${this.mutantIds.join(', ')}`
    return `Checker "${this.checkerName}" failed${mutants}: ${this.cause}`
  }
}

export type CheckResult = typeof CheckResultSchema.Type
export type FailedCheckResult = Extract<CheckResult, { readonly status: 'compileError' }>
export type PassedCheckResult = Extract<CheckResult, { readonly status: 'passed' }>
