import * as Arr from 'effect/Array'
import * as Boolean from 'effect/Boolean'
import * as Option from 'effect/Option'
import * as Predicate from 'effect/Predicate'
import {
  type BinaryExpression,
  type CallExpression,
  type FunctionLikeDeclaration,
  type NewExpression,
  type Node,
  SyntaxKind,
  type TypeNode,
} from 'typescript/unstable/ast'
import {
  isArrayLiteralExpression,
  isArrowFunction,
  isAsExpression,
  isBinaryExpression,
  isCallExpression,
  isConditionalExpression,
  isFunctionExpression,
  isFunctionLikeDeclaration,
  isIdentifier,
  isNewExpression,
  isObjectLiteralExpression,
  isParameterDeclaration,
  isParenthesizedExpression,
  isPropertyAssignment,
  isPropertyDeclaration,
  isReturnStatement,
  isSatisfiesExpression,
  isTypeReferenceNode,
  isVariableDeclaration,
} from 'typescript/unstable/ast/is'
import { type Type, TypeFlags } from 'typescript/unstable/async'

import type { ContextSlot, LeftOperandMember, ReturnTarget } from './classify-context-link.workflow.js'

export const isCallLike = (parent: Node): parent is CallExpression | NewExpression =>
  isCallExpression(parent) || isNewExpression(parent)

const isArgumentOf = (parent: CallExpression | NewExpression, node: Node): boolean =>
  Arr.some(parent.arguments ?? [], (argument) => argument === node)

const SHORT_CIRCUIT_OPERATORS: ReadonlyArray<SyntaxKind> = [
  SyntaxKind.QuestionQuestionToken,
  SyntaxKind.BarBarToken,
  SyntaxKind.AmpersandAmpersandToken,
]

const isConstName = (name: Node): boolean => isIdentifier(name) && name.text === 'const'

const isConstAssertion = (type: TypeNode): boolean => isTypeReferenceNode(type) && isConstName(type.typeName)

export const enclosingFunctionOf = (node: Node): Option.Option<FunctionLikeDeclaration> =>
  Option.flatMap(
    Option.fromUndefinedOr(node.parent),
    (parent) => isFunctionLikeDeclaration(parent) ? Option.some(parent) : enclosingFunctionOf(parent),
  )

const isExpressionFunction = (fn: FunctionLikeDeclaration): boolean => isArrowFunction(fn) || isFunctionExpression(fn)

type InitializedDeclaration = Node & {
  readonly initializer?: Node | undefined
  readonly type?: TypeNode | undefined
}

type OperandParent = Node & { readonly expression?: Node | undefined }

type ParentGuard = (parent: Node) => boolean

const INITIALIZED_DECLARATIONS: ReadonlyArray<ParentGuard> = [
  isVariableDeclaration,
  isPropertyDeclaration,
  isParameterDeclaration,
]

const OPERAND_PARENTS: ReadonlyArray<ParentGuard> = [
  isParenthesizedExpression,
  isAsExpression,
  isSatisfiesExpression,
  isReturnStatement,
]

const isInitializedDeclaration = (parent: Node): parent is InitializedDeclaration =>
  Arr.some(INITIALIZED_DECLARATIONS, (guard) => guard(parent))

const isOperandParent = (parent: Node): parent is OperandParent => Arr.some(OPERAND_PARENTS, (guard) => guard(parent))

type SlotReader = (parent: Node, node: Node) => Option.Option<ContextSlot>

const slotWhen = <N extends Node>(
  guard: (parent: Node) => parent is N,
  read: (parent: N, node: Node) => ContextSlot,
): SlotReader =>
(parent, node) => guard(parent) ? Option.some(read(parent, node)) : Option.none()

const slotIf = (filled: boolean, slot: ContextSlot, otherwise: ContextSlot): ContextSlot => filled ? slot : otherwise

const SLOT_READERS: ReadonlyArray<SlotReader> = [
  slotWhen(isCallLike, (call, node) => slotIf(isArgumentOf(call, node), 'argument', 'callee')),
  slotWhen(isBinaryExpression, (binary, node) => slotIf(binary.right === node, 'right', 'left')),
  slotWhen(
    isConditionalExpression,
    (conditional, node) => slotIf(conditional.condition === node, 'condition', 'branch'),
  ),
  slotWhen(isPropertyAssignment, (property, node) => slotIf(property.initializer === node, 'value', 'name')),
  slotWhen(isArrowFunction, (fn, node) => slotIf(fn.body === node, 'body', 'other')),
  slotWhen(
    isInitializedDeclaration,
    (declaration, node) => slotIf(declaration.initializer === node, 'initializer', 'other'),
  ),
  slotWhen(isArrayLiteralExpression, (): ContextSlot => 'element'),
  slotWhen(isObjectLiteralExpression, (): ContextSlot => 'member'),
  slotWhen(isOperandParent, (parent, node) => slotIf(parent.expression === node, 'operand', 'other')),
]

const slotIn = (parent: Node, node: Node): ContextSlot =>
  Option.getOrElse(Arr.findFirst(SLOT_READERS, (read) => read(parent, node)), (): ContextSlot => 'other')

export const slotOf = (node: Node): ContextSlot =>
  Option.match(Option.fromUndefinedOr(node.parent), {
    onNone: (): ContextSlot => 'other',
    onSome: (parent) => slotIn(parent, node),
  })

const unannotatedTargetOf = (fn: FunctionLikeDeclaration): ReturnTarget =>
  isExpressionFunction(fn) ? 'unannotated-expression' : 'unannotated-declaration'

const functionTargetOf = (fn: FunctionLikeDeclaration): ReturnTarget =>
  fn.type === undefined ? unannotatedTargetOf(fn) : 'annotated'

const returnStatementFunctionOf = (parent: Node): Option.Option<FunctionLikeDeclaration> =>
  isReturnStatement(parent) ? enclosingFunctionOf(parent) : Option.none()

const returnFunctionOf = (parent: Node): Option.Option<FunctionLikeDeclaration> =>
  isArrowFunction(parent) ? Option.some(parent) : returnStatementFunctionOf(parent)

export const returnTargetOf = (parent: Node): ReturnTarget =>
  Option.match(returnFunctionOf(parent), { onNone: (): ReturnTarget => 'none', onSome: functionTargetOf })

const MEMBER_FLAGS: ReadonlyArray<readonly [TypeFlags, LeftOperandMember]> = [
  [TypeFlags.Any, 'any'],
  [TypeFlags.Unknown, 'unknown'],
  [TypeFlags.Undefined | TypeFlags.Null | TypeFlags.Void, 'nullish'],
  [TypeFlags.String | TypeFlags.Number | TypeFlags.BigInt, 'primitive'],
  [TypeFlags.Object | TypeFlags.NonPrimitive | TypeFlags.ESSymbol | TypeFlags.UniqueESSymbol, 'always-truthy'],
]

type LiteralValue = string | number | boolean | bigint

const FALSY_LITERAL_VALUES: ReadonlyArray<LiteralValue> = ['', 0, 0n, false]

const BOOLEAN_LITERAL_NAMES: Partial<Record<string, boolean>> = { true: true, false: false }

const hasFlag = (type: Type, flags: TypeFlags): boolean => (type.flags & flags) !== 0

const intrinsicNameOf = (type: Type): Option.Option<string> =>
  'intrinsicName' in type ? Option.filter(Option.some(type.intrinsicName), Predicate.isString) : Option.none()

const intrinsicBooleanOf = (type: Type): Option.Option<boolean> =>
  Option.flatMap(intrinsicNameOf(type), (name) => Option.fromUndefinedOr(BOOLEAN_LITERAL_NAMES[name]))

const literalValueOf = (type: Type): Option.Option<LiteralValue> =>
  type.isLiteralType()
    ? Option.orElse(Option.fromUndefinedOr<LiteralValue>(type.value), () => intrinsicBooleanOf(type))
    : Option.none()

const literalMemberOf = (type: Type): LeftOperandMember =>
  Option.match(literalValueOf(type), {
    onNone: (): LeftOperandMember => 'unrecognized',
    onSome: (value) =>
      Boolean.match(FALSY_LITERAL_VALUES.includes(value), {
        onTrue: (): LeftOperandMember => 'falsy-literal',
        onFalse: (): LeftOperandMember => 'truthy-literal',
      }),
  })

export const leftOperandMemberOf = (type: Type): LeftOperandMember =>
  Option.getOrElse(
    Option.map(Arr.findFirst(MEMBER_FLAGS, ([flags]) => hasFlag(type, flags)), ([, member]) => member),
    () => literalMemberOf(type),
  )

const isShortCircuit = (parent: Node): parent is BinaryExpression =>
  isBinaryExpression(parent) && Arr.contains(SHORT_CIRCUIT_OPERATORS, parent.operatorToken.kind)

export const shortCircuitParentOf = (parent: Node): Option.Option<BinaryExpression> =>
  isShortCircuit(parent) ? Option.some(parent) : Option.none()

export const operatorOf = (parent: Node): SyntaxKind =>
  isBinaryExpression(parent) ? parent.operatorToken.kind : SyntaxKind.Unknown

export const constAssertionOf = (parent: Node): boolean => isAsExpression(parent) && isConstAssertion(parent.type)

export const annotatedOf = (parent: Node): boolean => isInitializedDeclaration(parent) && parent.type !== undefined
