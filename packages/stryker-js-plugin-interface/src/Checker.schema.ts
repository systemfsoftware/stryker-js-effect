import * as S from 'effect/Schema'

import { IgnoreStatusReasonText } from './ignore-rule.schema.js'
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

/**
 * The digest of the TypeScript program a checker loaded: SHA-256 over the sorted
 * hashes of every source file in the program (lib and node_modules declarations
 * included), every tsconfig in its chain, the TypeScript version, the checker
 * plugin version, and the checker's options. A `CompileError` verdict is reusable
 * only when two runs' digests are byte-equal, so a missing digest is never a match.
 */
export const ProgramDigest = S.String.check(
  S.isPattern(/^[0-9a-f]{64}$/u, {
    expected: 'a 64-character lowercase hexadecimal program digest',
  }),
).pipe(S.brand('ProgramDigest'))
export type ProgramDigest = typeof ProgramDigest.Type

export const CheckResultSchema = S.Union([
  S.Struct({ status: S.Literal('passed') }),
  S.Struct({ status: S.Literal('compileError'), reason: S.String }),
  S.Struct({ status: S.Literal('ignored'), reason: IgnoreStatusReasonText }),
]).pipe(S.toTaggedUnion('status'))

export const CheckAnswerSchema = S.Union([
  S.Struct({ status: S.Literal('passed') }),
  S.Struct({ status: S.Literal('compileError'), reason: S.String }),
  S.Struct({ status: S.Literal('ignored'), reason: S.optional(S.Unknown) }),
]).pipe(S.toTaggedUnion('status'))
export type CheckAnswer = typeof CheckAnswerSchema.Type

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
export type IgnoredCheckResult = Extract<CheckResult, { readonly status: 'ignored' }>
export type PassedCheckResult = Extract<CheckResult, { readonly status: 'passed' }>
