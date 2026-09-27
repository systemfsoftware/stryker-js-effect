import { Mutant } from '@systemfsoftware/stryker-js-plugin-interface'
import * as S from 'effect/Schema'

export const MutatorNameSchema = S.String.pipe(
  S.check(
    S.isPattern(/^(?:[a-z][a-z0-9]*(?:-[a-z0-9]+)*\/)?[a-zA-Z][a-zA-Z0-9]*(?: [a-zA-Z][a-zA-Z0-9]*)*$/),
  ),
)
const DirectiveReasonSchema = S.String.pipe(S.check(S.isPattern(/^\S(?:[^\r\n\u2028\u2029]*\S)?$/)))

export const DirectiveSchema = S.Struct({
  action: S.Literals(['disable', 'restore']),
  scope: S.Literals(['next-line', 'block']),
  mutatorNames: S.Array(MutatorNameSchema).check(S.isMinLength(1)),
  reason: DirectiveReasonSchema,
})
export type Directive = typeof DirectiveSchema.Type

export const LocatedDirectiveSchema = S.Struct({
  directive: DirectiveSchema,
  at: Mutant.Position,
  governedLine: Mutant.Line,
})
export type LocatedDirective = typeof LocatedDirectiveSchema.Type

export const UnusedDirectiveSchema = S.Struct({
  directive: DirectiveSchema,
  at: Mutant.Position,
  mutatorName: MutatorNameSchema,
})
export type UnusedDirective = typeof UnusedDirectiveSchema.Type
