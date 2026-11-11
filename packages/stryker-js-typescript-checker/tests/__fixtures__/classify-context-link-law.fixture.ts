import * as S from 'effect/Schema'
import { SyntaxKind } from 'typescript/unstable/ast'

export const ListedLink = S.Literals([
  'parenthesized',
  'array-element',
  'object-member',
  'property-value',
  'conditional-branch',
  'binary-right',
  'as-operand',
  'satisfies-operand',
  'call-argument',
  'new-argument',
  'arrow-body',
  'return-operand',
  'variable-initializer',
  'property-initializer',
  'parameter-initializer',
])
export type ListedLink = typeof ListedLink.Type

export interface LinkSpec {
  readonly kind: SyntaxKind
  readonly slot: string
  readonly outcomes: ReadonlyArray<string>
}

const CLIMB_ONLY = ['climb']
const DECLARED_OR_UNENFORCED = ['declared', 'unenforced']

export const LISTED_LINKS: Record<ListedLink, LinkSpec> = {
  parenthesized: { kind: SyntaxKind.ParenthesizedExpression, slot: 'operand', outcomes: CLIMB_ONLY },
  'array-element': { kind: SyntaxKind.ArrayLiteralExpression, slot: 'element', outcomes: CLIMB_ONLY },
  'object-member': { kind: SyntaxKind.ObjectLiteralExpression, slot: 'member', outcomes: CLIMB_ONLY },
  'property-value': { kind: SyntaxKind.PropertyAssignment, slot: 'value', outcomes: CLIMB_ONLY },
  'conditional-branch': { kind: SyntaxKind.ConditionalExpression, slot: 'branch', outcomes: CLIMB_ONLY },
  'binary-right': { kind: SyntaxKind.BinaryExpression, slot: 'right', outcomes: ['declared', 'climb', 'unenforced'] },
  'as-operand': { kind: SyntaxKind.AsExpression, slot: 'operand', outcomes: ['climb', 'unenforced'] },
  'satisfies-operand': { kind: SyntaxKind.SatisfiesExpression, slot: 'operand', outcomes: ['declared'] },
  'call-argument': { kind: SyntaxKind.CallExpression, slot: 'argument', outcomes: ['call-argument'] },
  'new-argument': { kind: SyntaxKind.NewExpression, slot: 'argument', outcomes: ['call-argument'] },
  'arrow-body': { kind: SyntaxKind.ArrowFunction, slot: 'body', outcomes: ['declared', 'climb', 'unenforced'] },
  'return-operand': {
    kind: SyntaxKind.ReturnStatement,
    slot: 'operand',
    outcomes: ['declared', 'climb-function', 'unenforced'],
  },
  'variable-initializer': {
    kind: SyntaxKind.VariableDeclaration,
    slot: 'initializer',
    outcomes: DECLARED_OR_UNENFORCED,
  },
  'property-initializer': {
    kind: SyntaxKind.PropertyDeclaration,
    slot: 'initializer',
    outcomes: DECLARED_OR_UNENFORCED,
  },
  'parameter-initializer': { kind: SyntaxKind.Parameter, slot: 'initializer', outcomes: DECLARED_OR_UNENFORCED },
}

export const ListedOutcome = S.Literals(['climb', 'climb-function', 'declared', 'call-argument', 'unenforced'])
export type ListedOutcome = typeof ListedOutcome.Type

export const ListedOperator = S.Literals(['equals', 'nullish', 'or', 'and', 'unknown'])
export type ListedOperator = typeof ListedOperator.Type

export interface OperatorPolicy {
  readonly operator: SyntaxKind
  readonly reaching: ReadonlyArray<string>
  readonly reached: ListedOutcome
  readonly unreached: ListedOutcome
}

export const OPERATOR_POLICIES: Record<ListedOperator, OperatorPolicy> = {
  equals: { operator: SyntaxKind.EqualsToken, reaching: [], reached: 'declared', unreached: 'declared' },
  nullish: {
    operator: SyntaxKind.QuestionQuestionToken,
    reaching: ['unknown', 'nullish'],
    reached: 'climb',
    unreached: 'unenforced',
  },
  or: {
    operator: SyntaxKind.BarBarToken,
    reaching: ['unknown', 'nullish', 'primitive', 'falsy-literal'],
    reached: 'climb',
    unreached: 'unenforced',
  },
  and: {
    operator: SyntaxKind.AmpersandAmpersandToken,
    reaching: ['unknown', 'primitive', 'truthy-literal', 'always-truthy'],
    reached: 'climb',
    unreached: 'unenforced',
  },
  unknown: { operator: SyntaxKind.Unknown, reaching: [], reached: 'unenforced', unreached: 'unenforced' },
}

export const RETURN_TARGET_OUTCOMES: Readonly<Record<string, ListedOutcome>> = {
  annotated: 'declared',
  'unannotated-expression': 'climb-function',
  'unannotated-declaration': 'unenforced',
  none: 'unenforced',
}
