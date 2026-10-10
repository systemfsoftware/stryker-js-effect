import * as S from 'effect/Schema'

const TemplateText = S.String.check(S.isPattern(/^[^`\\$]*$/))

const NonNegativeBigInt = S.BigInt.check(S.isGreaterThanOrEqualToBigInt(0n))

export const ContextFreeProduction = S.Union([
  S.TaggedStruct('StringLiteral', { value: S.String }),
  S.TaggedStruct('TemplateLiteral', { text: TemplateText }),
  S.TaggedStruct('NumericLiteral', { magnitude: S.Natural, negative: S.Boolean }),
  S.TaggedStruct('BigintLiteral', { magnitude: NonNegativeBigInt, negative: S.Boolean }),
  S.TaggedStruct('Keyword', {
    text: S.Literals(['true', 'false', 'null', 'undefined', '{}', '() => undefined', '() => {}']),
  }),
])
export type ContextFreeProduction = typeof ContextFreeProduction.Type

export const ClassificationCase = S.Union([
  S.TaggedStruct('Literal', { production: ContextFreeProduction, expected: S.Literal('context-free') }),
  S.TaggedStruct('Parenthesized', { production: ContextFreeProduction, expected: S.Literal('not-context-free') }),
  S.TaggedStruct('SemicolonSuffixed', { production: ContextFreeProduction, expected: S.Literal('not-context-free') }),
  S.TaggedStruct('ArrayWrapped', { production: ContextFreeProduction, expected: S.Literal('not-context-free') }),
  S.TaggedStruct('ObjectLiteral', {
    production: ContextFreeProduction,
    key: S.String,
    expected: S.Literal('not-context-free'),
  }),
  S.TaggedStruct('ArrowFunction', {
    parameter: S.NonEmptyString,
    expected: S.Literal('not-context-free'),
  }),
])
export type ClassificationCase = typeof ClassificationCase.Type
