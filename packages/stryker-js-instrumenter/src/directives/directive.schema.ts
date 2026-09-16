import * as S from 'effect/Schema'
import { SourceColumnSchema, SourceLineSchema } from '../Instrument.schema.js'

const MutatorNameSchema = S.String.pipe(S.check(S.isPattern(/^[a-zA-Z]+(?: [a-zA-Z]+)*$/)))
const DirectiveReasonSchema = S.String.pipe(S.check(S.isPattern(/^\S(?:[\s\S]*\S)?$/)))

export const DirectiveSchema = S.Struct({
  action: S.Literals(['disable', 'restore']),
  scope: S.Literals(['next-line', 'block']),
  mutatorNames: S.Array(MutatorNameSchema).check(S.isMinLength(1)),
  reason: DirectiveReasonSchema,
})
export type Directive = typeof DirectiveSchema.Type

export const LocatedPositionSchema = S.Struct({
  line: SourceLineSchema,
  column: SourceColumnSchema,
})

export const LocatedDirectiveSchema = S.Struct({
  directive: DirectiveSchema,
  at: LocatedPositionSchema,
})
export type LocatedDirective = typeof LocatedDirectiveSchema.Type

export const UnusedDirectiveSchema = S.Struct({
  directive: DirectiveSchema,
  at: LocatedPositionSchema,
  mutatorName: S.String,
})
export type UnusedDirective = typeof UnusedDirectiveSchema.Type
