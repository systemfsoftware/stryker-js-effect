import { type AST, RegExpParser, visitRegExpAST } from '@eslint-community/regexpp'
import * as Match from 'effect/Match'
import * as Predicate from 'effect/Predicate'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import type {
  ArrayExpression,
  ArrowFunctionExpression,
  AssignmentExpression,
  BinaryExpression,
  BlockStatement,
  BooleanLiteral,
  CallExpression,
  ClassBody,
  DoWhileStatement,
  Expression,
  ForStatement,
  IdentifierReference,
  IfStatement,
  Literal,
  LogicalExpression,
  MemberExpression,
  MethodDefinition,
  NewExpression,
  Node,
  ObjectExpression,
  ObjectProperty,
  PrivateInExpression,
  PropertyDefinition,
  SpreadElement,
  StaticMemberExpression,
  StringLiteral,
  SwitchCase,
  TemplateElement,
  TemplateLiteral,
  UnaryExpression,
  UpdateExpression,
  WhileStatement,
} from './Ast.handle.js'
import { MutantNotApplied } from './Instrument.schema.js'
import type { Location } from './Location.schema.js'
import { Mutant as ApiMutant } from './Mutant.schema.js'
import type { PlannedMutant } from './plan-mutants.workflow.js'

import { dual } from 'effect/Function'
import {
  arrayExpression,
  arrowFunctionExpression,
  blockStatement,
  booleanLiteral,
  callExpression,
  cloneNode,
  identifier,
  make,
  memberExpression,
  newExpression,
  nodeType,
  regExpLiteral,
  spanOf,
  stringLiteral,
  templateElement,
  templateLiteral,
  traverse,
  type TraversePath,
  unaryExpression,
  updateExpression,
} from './Ast.handle.js'
import { atomicUpdateSplitMutator } from './AtomicUpdateSplit.handle.js'
import { finalizerEscapeMutator } from './FinalizerEscape.handle.js'
import { synchronizationRemovalMutator } from './SynchronizationRemoval.handle.js'

export type { Node }
/**
 * Node identity: same kind, same span. oxc nodes always carry a range
 * (parsed with `range: true`), which is a stronger identity than the old
 * line/column loc.
 */
function eqNode(a: Node, b: Node): boolean {
  const identity = nodeIdentity(a)
  return identity !== undefined && identity === nodeIdentity(b)
}

function nodeIdentity(node: Node): string | undefined {
  const span = spanOf(node)
  if (span === undefined) {
    return undefined
  }
  return `${node.type}:${span.start}:${span.end}`
}

export interface Mutable {
  mutatorName: string
  ignoreReason?: string | undefined
  replacement: Node
}
export interface Mutant extends Mutable {
  readonly id: string
  readonly fileName: string
  readonly original: Node
  readonly location: Location
  readonly replacementCode: string
}
function orDefault<T>(value: T | undefined, fallback: T): T {
  return value ?? fallback
}

function createMutantDataFirst(
  planned: PlannedMutant,
  fileName: string,
  original: Node,
  replacement: Node,
): Mutant {
  return {
    id: planned.id,
    fileName,
    original,
    location: planned.location,
    replacement,
    mutatorName: planned.mutatorName,
    ignoreReason: planned.ignoreReason,
    replacementCode: planned.replacementCode,
  }
}

export const createMutant: {
  (planned: PlannedMutant, fileName: string, original: Node, replacement: Node): Mutant
  (fileName: string, original: Node, replacement: Node): (planned: PlannedMutant) => Mutant
} = dual((args: IArguments): boolean => args.length >= 4, createMutantDataFirst)
export function toApiMutant(mutant: Mutant): Result.Result<ApiMutant, S.SchemaError> {
  const baseFields = {
    _tag: 'Mutant' as const,
    fileName: mutant.fileName,
    id: mutant.id,
    location: mutant.location,
    mutatorName: mutant.mutatorName,
    replacement: mutant.replacementCode,
  }
  return S.decodeResult(ApiMutant)(
    mutant.ignoreReason === undefined
      ? baseFields
      : { ...baseFields, statusReason: mutant.ignoreReason, status: 'Ignored' },
  )
}

function applyMutantDataFirst(mutant: Mutant, originalTree: Node): Result.Result<Node, MutantNotApplied> {
  return Match.value(originalTree === mutant.original).pipe(
    Match.when(true, () => Result.succeed(mutant.replacement)),
    Match.when(false, () => cloneWithReplacement(mutant, originalTree)),
    Match.exhaustive,
  )
}

export const applyMutant: {
  (mutant: Mutant, originalTree: Node): Result.Result<Node, MutantNotApplied>
  (originalTree: Node): (mutant: Mutant) => Result.Result<Node, MutantNotApplied>
} = dual((args: IArguments): boolean => args.length >= 2, applyMutantDataFirst)

function cloneWithReplacement(mutant: Mutant, originalTree: Node): Result.Result<Node, MutantNotApplied> {
  const mutatedAst = cloneNode(originalTree)
  const { original, replacement } = mutant
  return Match.value(hasReplaced(mutatedAst, original, replacement)).pipe(
    Match.when(true, () => Result.succeed(mutatedAst)),
    Match.when(
      false,
      () => Result.fail(MutantNotApplied.make({ fileName: mutant.fileName, mutatorName: mutant.mutatorName })),
    ),
    Match.exhaustive,
  )
}

function hasReplaced(root: Node, original: Node, replacement: Node): boolean {
  let applied = false
  traverse(make(root), {
    enter(path) {
      if (!applied) {
        applied = replaceFirstMatch(path, original, replacement)
      }
    },
  })
  return applied
}

function replaceFirstMatch(path: TraversePath, original: Node, replacement: Node): boolean {
  if (eqNode(path.node, original) === false) {
    return false
  }
  path.replaceWith(replacement)
  return true
}

export interface MutatorContext {
  readonly parent: Node | undefined
  readonly grandParent: Node | undefined
  readonly ancestors: readonly Node[]
}

/**
 * One mutator: a pure function from a node to the mutants it produces.
 *
 * A function, not an object with a `mutate` method and a `name` field. The name
 * lived inside every mutator AND as its position in a hand-written list, so the
 * two could disagree; the registry's key is now the only place a name is
 * written.
 */
export type Mutator = (node: Node, context: MutatorContext) => Iterable<Node>

export interface MutatorOptions {
  excludedMutations: string[]
  optInMutations: readonly string[]
  noHeader?: boolean
}

/**
 * The mutations of a regular expression pattern.
 *
 * Pure: a pattern and its flags in, replacement patterns out. No I/O, no clock,
 * no throwing — a pattern this cannot parse yields no mutants, which is the
 * honest answer for a literal whose syntax the engine does not model.
 *
 * The transformation set is fixed and small, and each member changes exactly
 * one thing about the pattern:
 *
 * | family                  | example                  |
 * | ----------------------- | ------------------------ |
 * | anchor removal          | `^abc$` -> `abc$`, `^abc` |
 * | character class negation| `[abc]` <-> `[^abc]`      |
 * | predefined class negation| `\d` <-> `\D`, `\p{L}` <-> `\P{L}` |
 * | quantifier removal      | `a+`, `a*`, `a{2,3}` -> `a` |
 * | lookaround negation     | `(?=a)` <-> `(?!a)`, `(?<=a)` <-> `(?<!a)` |
 *
 * Alternation and grouping are deliberately untouched: swapping a branch or
 * dropping a group produces mutants that survive for reasons unrelated to the
 * test suite's strength, which inflates a score rather than measuring one.
 *
 * The order is part of the contract, because a mutant's identity in a report is
 * its position: anchors first, then each remaining position left to right with
 * quantifier removal ahead of class negation.
 */
function mutateRegexPattern(pattern: string, flags: string | undefined): readonly string[] {
  if (pattern.length === 0) {
    return []
  }
  return parseRegexMutants(pattern, orDefault(flags, ''))
}

function parseRegexMutants(pattern: string, flags: string): readonly string[] {
  try {
    const groups = collectSplices(pattern, flags)
    groups.rest.sort((a, b) => a.start - b.start || a.priority - b.priority)
    return [...groups.bol, ...groups.eol, ...groups.rest].map((splice) => spliceText(pattern, splice))
  } catch {
    return []
  }
}

interface Splice {
  readonly start: number
  readonly end: number
  readonly text: string
}

interface PrioritizedSplice extends Splice {
  readonly priority: number
}

interface SpliceGroups {
  readonly bol: Splice[]
  readonly eol: Splice[]
  readonly rest: PrioritizedSplice[]
}

function collectSplices(pattern: string, flags: string): SpliceGroups {
  const groups: SpliceGroups = { bol: [], eol: [], rest: [] }
  const parser = new RegExpParser()
  const ast = parser.parsePattern(pattern, undefined, undefined, {
    unicode: flags.includes('u'),
    unicodeSets: flags.includes('v'),
  })
  visitRegExpAST(ast, {
    onAssertionEnter(assertion) {
      collectAssertion(assertion, pattern, groups)
    },
    onCharacterClassEnter(characterClass) {
      collectCharacterClass(characterClass, groups)
    },
    onCharacterSetEnter(characterSet) {
      collectCharacterSet(characterSet, groups)
    },
    onQuantifierEnter(quantifier) {
      collectQuantifier(quantifier, groups)
    },
  })
  return groups
}

function collectAssertion(assertion: AST.Assertion, pattern: string, groups: SpliceGroups): void {
  Match.value(assertion).pipe(
    Match.when(isEdgeAssertion, (edge) => pushAnchor(edge, pattern, groups)),
    Match.when(isLookaround, (lookaround) => groups.rest.push(lookaroundNegation(lookaround))),
    Match.orElse(() => undefined),
  )
}

function isEdgeAssertion(assertion: AST.Assertion): assertion is AST.EdgeAssertion {
  return assertion.kind === 'start' || assertion.kind === 'end'
}

function isLookaround(assertion: AST.Assertion): assertion is AST.LookaroundAssertion {
  return assertion.kind === 'lookahead' || assertion.kind === 'lookbehind'
}

function pushAnchor(edge: AST.EdgeAssertion, pattern: string, groups: SpliceGroups): void {
  pushWhen(anchorGroup(edge, groups), anchorRemoval(edge, pattern))
}

function anchorGroup(edge: AST.EdgeAssertion, groups: SpliceGroups): Splice[] {
  return Match.value(edge.kind).pipe(
    Match.when('start', () => groups.bol),
    Match.orElse(() => groups.eol),
  )
}

function lookaroundNegation(lookaround: AST.LookaroundAssertion): PrioritizedSplice {
  return Match.value(lookaround.kind).pipe(
    Match.when('lookahead', () => lookaroundSplice(lookaround, 2)),
    Match.orElse(() => lookaroundSplice(lookaround, 3)),
  )
}

function lookaroundSplice(lookaround: AST.LookaroundAssertion, markerWidth: number): PrioritizedSplice {
  return {
    start: lookaround.start + markerWidth,
    end: lookaround.start + markerWidth + 1,
    text: negationMarker(lookaround.negate),
    priority: 1,
  }
}

function negationMarker(negate: boolean): string {
  return Match.value(negate).pipe(
    Match.when(true, () => '='),
    Match.orElse(() => '!'),
  )
}

function collectCharacterClass(characterClass: AST.CharacterClass, groups: SpliceGroups): void {
  const pos = characterClass.start + 1
  if (characterClass.negate) {
    groups.rest.push({ start: pos, end: pos + 1, text: '', priority: 1 })
  } else {
    groups.rest.push({ start: pos, end: pos, text: '^', priority: 1 })
  }
}

function collectCharacterSet(characterSet: AST.CharacterSet, groups: SpliceGroups): void {
  pushWhen(groups.rest, characterSetSplice(characterSet))
}

function characterSetSplice(characterSet: AST.CharacterSet): PrioritizedSplice | undefined {
  return Match.value(characterSet.kind).pipe(
    Match.when((kind) => NEGATABLE_CHARACTER_SETS[kind] === true, () => classSplice(characterSet)),
    Match.orElse(() => undefined),
  )
}

const NEGATABLE_CHARACTER_SETS: Readonly<Record<string, true>> = {
  digit: true,
  space: true,
  word: true,
  property: true,
}

const PROPERTY_MARKERS: Readonly<Partial<Record<string, string>>> = { p: 'P', P: 'p' }

function classSplice(characterSet: AST.CharacterSet): PrioritizedSplice {
  const pos = characterSet.start + 1
  return { start: pos, end: pos + 1, text: invertedMarker(orDefault(characterSet.raw[1], '')), priority: 2 }
}

/** `\d`-style sets invert by letter case, `\p{}` by `p`/`P`. */
function invertedMarker(marker: string): string {
  const propertyMarker = PROPERTY_MARKERS[marker]
  if (propertyMarker !== undefined) {
    return propertyMarker
  }
  return invertLetterCase(marker)
}

function invertLetterCase(letter: string): string {
  if (letter === letter.toUpperCase()) {
    return letter.toLowerCase()
  }
  return letter.toUpperCase()
}

function collectQuantifier(quantifier: AST.Quantifier, groups: SpliceGroups): void {
  groups.rest.push({ start: quantifier.start, end: quantifier.end, text: quantifier.element.raw, priority: 0 })
}

function anchorRemoval(assertion: AST.Assertion, pattern: string): Splice | undefined {
  const splice = { start: assertion.start, end: assertion.end, text: '' }
  if (spliceText(pattern, splice).length === 0) {
    return undefined
  }
  return splice
}

function pushWhen<T>(list: T[], splice: T | undefined): void {
  if (splice !== undefined) {
    list.push(splice)
  }
}

function spliceText(pattern: string, splice: Splice): string {
  return pattern.slice(0, splice.start) + splice.text + pattern.slice(splice.end)
}

const NO_MUTANTS: readonly Node[] = []

function isPresent<T>(value: T | null | undefined): value is T {
  return value !== null && value !== undefined
}

/** A copy of the node carrying a different operator. */
function withOperator<T extends Node & { operator: string }>(node: T, operator: T['operator']): T {
  const replacement = cloneNode(node)
  replacement.operator = operator
  return replacement
}

/** The mutants a condition selects, built only when it holds. */
function mutantsWhen(holds: boolean, build: () => readonly Node[]): readonly Node[] {
  return Match.value(holds).pipe(
    Match.when(true, build),
    Match.orElse(() => NO_MUTANTS),
  )
}

const hasPropertyIn = <B = unknown>(node: object, key: string): node is Record<string, B> => key in node

const readPropertyOf = <B = unknown>(node: object, key: string): B | undefined =>
  hasPropertyIn<B>(node, key) ? node[key] : undefined

function propertyOf<A = unknown, B = unknown>(node: A, key: string): B | undefined {
  return Predicate.isObject(node) ? readPropertyOf<B>(node, key) : undefined
}

function isIdentifier(node: unknown): node is IdentifierReference {
  return nodeType(node) === 'Identifier'
}

function isCallExpression(node: Node): node is CallExpression {
  return node.type === 'CallExpression'
}

const arithmeticOperatorReplacements = Object.freeze(
  {
    '+': '-',
    '-': '+',
    '*': '/',
    '/': '*',
    '%': '*',
  } as const,
)

const ARITHMETIC_OPERATOR_KEYS: readonly string[] = Object.keys(arithmeticOperatorReplacements)

type ArithmeticBinary = BinaryExpression & { operator: keyof typeof arithmeticOperatorReplacements }

const arithmeticOperatorMutator: Mutator = (node) =>
  Match.value(node).pipe(
    Match.when(isArithmeticBinary, (binary) => [withOperator(binary, arithmeticOperatorReplacements[binary.operator])]),
    Match.orElse(() => NO_MUTANTS),
  )

function isArithmeticBinary(node: Node): node is ArithmeticBinary {
  return isBinaryExpression(node) && isSupportedArithmeticOperator(node.operator, node)
}

function isBinaryExpression(node: Node): node is BinaryExpression {
  return node.type === 'BinaryExpression' && !isPrivateInExpression(node)
}

function isPrivateInExpression(node: BinaryExpression | PrivateInExpression): node is PrivateInExpression {
  return node.left.type === 'PrivateIdentifier'
}

function isSupportedArithmeticOperator(operator: string, node: BinaryExpression): boolean {
  return ARITHMETIC_OPERATOR_KEYS.includes(operator) && !isStringConcatenation(node)
}

/** `1 + x` is arithmetic; `"a" + x` concatenates, and there is nothing to mutate. */
function isStringConcatenation(node: BinaryExpression): boolean {
  return isStringLike(node.right) || isStringLike(outerLeftOperand(node))
}

/** A chained `a + b + c` carries its value on the innermost left operand's right side. */
function outerLeftOperand(node: BinaryExpression): Node {
  if (node.left.type === 'BinaryExpression') {
    return node.left.right
  }
  return node.left
}

type ArrayConstructorCall = (CallExpression | NewExpression) & {
  callee: IdentifierReference & { name: 'Array' }
}

const arrayDeclarationMutator: Mutator = (node) =>
  Match.value(node).pipe(
    Match.when(isArrayExpression, (array) => [arrayDeclarationReplacement(array)]),
    Match.when(isArrayConstructorCall, (construct) => [arrayConstructorReplacement(construct)]),
    Match.orElse(() => NO_MUTANTS),
  )

function isArrayExpression(node: Node): node is ArrayExpression {
  return node.type === 'ArrayExpression'
}

function arrayDeclarationReplacement(array: ArrayExpression): Expression {
  if (array.elements.length > 0) {
    return arrayExpression([])
  }
  return arrayExpression([stringLiteral('Stryker was here')])
}

function isArrayConstructorCall(node: Node): node is ArrayConstructorCall {
  return isCallOrNewExpression(node) && isArrayIdentifier(node.callee)
}

function isCallOrNewExpression(node: Node): node is CallExpression | NewExpression {
  return node.type === 'CallExpression' || node.type === 'NewExpression'
}

function isArrayIdentifier(node: Node): node is IdentifierReference & { name: 'Array' } {
  return node.type === 'Identifier' && node.name === 'Array'
}

function arrayConstructorReplacement(construct: ArrayConstructorCall): Expression {
  const mutatedCallArgs = constructorArguments(construct.arguments)
  if (construct.type === 'NewExpression') {
    return newExpression(cloneNode(construct.callee), mutatedCallArgs)
  }
  return callExpression(cloneNode(construct.callee), mutatedCallArgs)
}

function constructorArguments(args: ReadonlyArray<Expression | SpreadElement>): Expression[] {
  if (args.length > 0) {
    return []
  }
  return [arrayExpression([])]
}

const arrowFunctionMutator: Mutator = (node) =>
  Match.value(node).pipe(
    Match.when(isExpressionBodiedArrow, () => [arrowFunctionExpression([], identifier('undefined'))]),
    Match.orElse(() => NO_MUTANTS),
  )

function isExpressionBodiedArrow(node: Node): node is ArrowFunctionExpression {
  return node.type === 'ArrowFunctionExpression' && hasMutableArrowBody(node.body)
}

function hasMutableArrowBody(body: BlockStatement | Expression): boolean {
  return body.type !== 'BlockStatement' && !isUndefinedExpression(body)
}

function isUndefinedExpression(node: BlockStatement | Expression): node is IdentifierReference {
  return node.type === 'Identifier' && node.name === 'undefined'
}

const assignmentOperatorReplacements = Object.freeze(
  {
    '+=': '-=',
    '-=': '+=',
    '*=': '/=',
    '/=': '*=',
    '%=': '*=',
    '<<=': '>>=',
    '>>=': '<<=',
    '&=': '|=',
    '|=': '&=',
    '&&=': '||=',
    '||=': '&&=',
    '??=': '&&=',
  } as const,
)

function isStringLike(value: unknown): value is TemplateLiteral | StringLiteral {
  return isTemplateLiteral(value) || isStringLiteral(value)
}

function isTemplateLiteral(value: unknown): value is TemplateLiteral {
  return nodeType(value) === 'TemplateLiteral'
}

function isStringLiteral(value: unknown): value is StringLiteral {
  return nodeType(value) === 'Literal' && hasStringValue(value)
}

function hasStringValue<A = unknown>(value: A): boolean {
  if (!Predicate.hasProperty(value, 'value')) {
    return false
  }
  return typeof value['value'] === 'string'
}

const stringAssignmentTypes = Object.freeze(['&&=', '||=', '??='])

const ASSIGNMENT_OPERATOR_KEYS: readonly string[] = Object.keys(assignmentOperatorReplacements)

type AssignmentBinary = AssignmentExpression & { operator: keyof typeof assignmentOperatorReplacements }

const assignmentOperatorMutator: Mutator = (node) =>
  Match.value(node).pipe(
    Match.when(isMutatableAssignment, (assignment) => [
      withOperator(assignment, assignmentOperatorReplacements[assignment.operator]),
    ]),
    Match.orElse(() => NO_MUTANTS),
  )

function isMutatableAssignment(node: Node): node is AssignmentBinary {
  return node.type === 'AssignmentExpression' && isSupportedAssignment(node)
}

function isSupportedAssignment(node: AssignmentExpression): boolean {
  return ASSIGNMENT_OPERATOR_KEYS.includes(node.operator) && isSupportedAssignmentExpression(node)
}

function isSupportedAssignmentExpression(node: AssignmentExpression): boolean {
  return !isStringLike(node.right) || stringAssignmentTypes.includes(node.operator)
}

const blockStatementMutator: Mutator = (node, context) =>
  mutantsWhen(isMutableBlock(node, context), () => [blockStatement([])])

function isMutableBlock(node: Node, context: MutatorContext): boolean {
  return node.type === 'BlockStatement' && isValid(node, context)
}

function isValid(node: BlockStatement, context: MutatorContext): boolean {
  return !isEmpty(node) && !isInvalidConstructorBody(node, context)
}

function isEmpty(node: BlockStatement): boolean {
  return node.body.length === 0
}

function isInvalidConstructorBody(block: BlockStatement, context: MutatorContext): boolean {
  const parent = context.parent
  // oxc: the constructor is a MethodDefinition whose `value` is the function
  return isConstructorMethod(parent) && constructorBodyMatters(block, parent, context)
}

function isConstructorMethod(node: Node | undefined): node is MethodDefinition {
  return isMethodDefinition(node) && node.kind === 'constructor'
}

function isMethodDefinition(node: Node | undefined): node is MethodDefinition {
  return node?.type === 'MethodDefinition'
}

function constructorBodyMatters(
  block: BlockStatement,
  constructor: MethodDefinition,
  context: MutatorContext,
): boolean {
  return containsSuperCall(block) && hasConstructorInitialization(constructor, context)
}

/** A derived constructor's body is load-bearing: it runs `super()` and seeds parameter properties. */
function hasConstructorInitialization(constructor: MethodDefinition, context: MutatorContext): boolean {
  return [constructor.value.params.some(isParameterProperty), hasInitializedProperties(context)].some(Boolean)
}

type ParameterProperty = { readonly type: 'TSParameterProperty' }

function isParameterProperty(param: unknown): param is ParameterProperty {
  return nodeType(param) === 'TSParameterProperty'
}

function hasInitializedProperties(context: MutatorContext): boolean {
  const classBody = context.grandParent
  return isClassBody(classBody) && classBody.body.some(isInitializedField)
}

function isClassBody(node: Node | undefined): node is ClassBody {
  return node?.type === 'ClassBody'
}

function isInitializedField(member: Node): boolean {
  return isPropertyDefinition(member) && isPresent(member.value)
}

function isPropertyDefinition(node: Node): node is PropertyDefinition {
  return node.type === 'PropertyDefinition'
}

function isSuperType<A = unknown>(node: A): boolean {
  return Predicate.hasProperty(node, 'type') && node['type'] === 'Super'
}

function isSuperCallExpression<A = unknown>(node: A): boolean {
  return nodeType(node) === 'CallExpression' && isSuperType(propertyOf(node, 'callee'))
}

function containsSuperCall<A = unknown>(node: A): boolean {
  return isObjectLike(node) && containsSuperIn(node)
}

function isObjectLike(value: unknown): value is object {
  return typeof value === 'object' && value !== null
}

function containsSuperIn(node: object): boolean {
  return isSuperReference(node) || hasSuperInChildren(node)
}

function isSuperReference<A = unknown>(node: A): boolean {
  return isSuperType(node) || isSuperCallExpression(node)
}

function hasSuperInChildren(node: object): boolean {
  return Object.keys(node).some((key) => containsSuperInValue(propertyOf(node, key)))
}

function containsSuperInValue<A = unknown>(value: A): boolean {
  if (Array.isArray(value)) {
    return value.some(containsSuperCall)
  }
  return containsSuperCall(value)
}

const booleanLiteralMutator: Mutator = (node) =>
  Match.value(node).pipe(
    Match.when(isBooleanLiteral, (literal) => [booleanLiteral(!literal.value)]),
    Match.when(isNegatedPrefix, (unary) => [cloneNode(unary.argument)]),
    Match.orElse(() => NO_MUTANTS),
  )

function isBooleanLiteral(node: Node): node is BooleanLiteral {
  return node.type === 'Literal' && typeof node.value === 'boolean'
}

function isNegatedPrefix(node: Node): node is UnaryExpression {
  return isUnaryExpression(node) && isNegation(node)
}

function isUnaryExpression(node: Node): node is UnaryExpression {
  return node.type === 'UnaryExpression'
}

type NegatedPrefix = UnaryExpression & { operator: '!' }

function isNegation(unary: UnaryExpression): unary is NegatedPrefix {
  return unary.operator === '!' && unary.prefix
}

const booleanOperators = Object.freeze(['!=', '!==', '&&', '<', '<=', '==', '===', '>', '>=', '||'])

const conditionalExpressionMutator: Mutator = (node, context) =>
  Match.value(isTestOfLoop(node, context)).pipe(
    Match.when(true, () => [booleanLiteral(false)]),
    Match.orElse(() => conditionTestMutants(node, context)),
  )

function conditionTestMutants(node: Node, context: MutatorContext): readonly Node[] {
  return Match.value(isTestOfCondition(node, context)).pipe(
    Match.when(true, () => [booleanLiteral(true), booleanLiteral(false)]),
    Match.orElse(() => booleanExpressionMutants(node, context)),
  )
}

function booleanExpressionMutants(node: Node, context: MutatorContext): readonly Node[] {
  return Match.value(isBooleanExpression(node)).pipe(
    Match.when(true, () => booleanExpressionReplacements(context)),
    Match.orElse(() => statementMutants(node)),
  )
}

function statementMutants(node: Node): readonly Node[] {
  return Match.value(node).pipe(
    Match.when(isEmptyTestForStatement, (loop) => [withEmptyTest(loop)]),
    Match.when(isNonEmptySwitchCase, (switchCase) => [withEmptyConsequent(switchCase)]),
    Match.orElse(() => NO_MUTANTS),
  )
}

function withEmptyTest(loop: ForStatement): ForStatement {
  const replacement = cloneNode(loop)
  replacement.test = booleanLiteral(false)
  return replacement
}

function withEmptyConsequent(switchCase: SwitchCase): SwitchCase {
  const replacement = cloneNode(switchCase)
  replacement.consequent = []
  return replacement
}

function isEmptyTestForStatement(node: Node): node is ForStatement {
  return node.type === 'ForStatement' && node.test === null
}

function isNonEmptySwitchCase(node: Node): node is SwitchCase {
  return node.type === 'SwitchCase' && node.consequent.length > 0
}

/** A `true` test only matters in `a && b` and a `false` one in `a || b`; any other parent takes both. */
function booleanExpressionReplacements(context: MutatorContext): readonly Node[] {
  return Match.value(logicalParentOperator(context.parent)).pipe(
    Match.when('&&', () => [booleanLiteral(true)]),
    Match.when('||', () => [booleanLiteral(false)]),
    Match.orElse(() => [booleanLiteral(true), booleanLiteral(false)]),
  )
}

function logicalParentOperator(parent: Node | undefined): string | undefined {
  return Match.value(parent).pipe(
    Match.when(isLogicalExpression, (logical) => logical.operator),
    Match.orElse(() => undefined),
  )
}

function isLogicalExpression(node: Node | undefined): node is LogicalExpression {
  return node?.type === 'LogicalExpression'
}

function isTestOfLoop(node: Node, context: MutatorContext): boolean {
  return isLoopStatement(context.parent) && testOfStatement(context.parent) === node
}

function isTestOfCondition(node: Node, context: MutatorContext): boolean {
  return isIfStatement(context.parent) && testOfStatement(context.parent) === node
}

function isLoopStatement(node: Node | undefined): boolean {
  return isTestBearingStatement(node) && LOOP_STATEMENT_KINDS[node.type] === true
}

function isIfStatement(node: Node | undefined): node is IfStatement {
  return node?.type === 'IfStatement'
}

const LOOP_STATEMENT_KINDS: Readonly<Record<string, true>> = {
  ForStatement: true,
  WhileStatement: true,
  DoWhileStatement: true,
}

const TEST_BEARING_KINDS: Readonly<Record<string, true>> = {
  IfStatement: true,
  WhileStatement: true,
  DoWhileStatement: true,
  ForStatement: true,
}

type TestBearingStatement = IfStatement | WhileStatement | DoWhileStatement | ForStatement

function isTestBearingStatement(node: Node | undefined): node is TestBearingStatement {
  return node !== undefined && TEST_BEARING_KINDS[node.type] === true
}

function testOfStatement(node: Node | undefined): Node | undefined {
  return Match.value(node).pipe(
    Match.when(isTestBearingStatement, (statement) => statement.test ?? undefined),
    Match.orElse(() => undefined),
  )
}

function isBooleanExpression(node: Node): node is BinaryExpression | LogicalExpression {
  return isOperatorExpression(node) && booleanOperators.includes(node.operator)
}

function isOperatorExpression(node: Node): node is BinaryExpression | LogicalExpression {
  return node.type === 'BinaryExpression' || node.type === 'LogicalExpression'
}

const operators = {
  '<': ['<=', '>='],
  '<=': ['<', '>'],
  '>': ['>=', '<='],
  '>=': ['>', '<'],
  '==': ['!='],
  '!=': ['=='],
  '===': ['!=='],
  '!==': ['==='],
} as const

const EQUALITY_OPERATOR_KEYS: readonly string[] = Object.keys(operators)

type EqualityBinary = BinaryExpression & { operator: keyof typeof operators }

const equalityOperatorMutator: Mutator = (node) =>
  Match.value(node).pipe(
    Match.when(isEqualityBinary, (binary) => mutatedEqualityOperators(binary)),
    Match.orElse(() => NO_MUTANTS),
  )

function isEqualityBinary(node: Node): node is EqualityBinary {
  return node.type === 'BinaryExpression' && EQUALITY_OPERATOR_KEYS.includes(node.operator)
}

function mutatedEqualityOperators(binary: EqualityBinary): readonly Node[] {
  return operators[binary.operator].map((operator) => withOperator(binary, operator))
}

const logicalOperatorReplacements = Object.freeze(
  {
    '&&': '||',
    '||': '&&',
    '??': '&&',
  } as const,
)

const LOGICAL_OPERATOR_KEYS: readonly string[] = Object.keys(logicalOperatorReplacements)

type LogicalBinary = LogicalExpression & { operator: keyof typeof logicalOperatorReplacements }

const logicalOperatorMutator: Mutator = (node) =>
  Match.value(node).pipe(
    Match.when(isSupportedLogicalOperator, (binary) => [
      withOperator(binary, logicalOperatorReplacements[binary.operator]),
    ]),
    Match.orElse(() => NO_MUTANTS),
  )

function isSupportedLogicalOperator(node: Node): node is LogicalBinary {
  return node.type === 'LogicalExpression' && LOGICAL_OPERATOR_KEYS.includes(node.operator)
}

const baseReplacements: Record<string, string | null> = {
  charAt: null,
  endsWith: 'startsWith',
  every: 'some',
  filter: null,
  reverse: null,
  slice: null,
  sort: null,
  substr: null,
  substring: null,
  toLocaleLowerCase: 'toLocaleUpperCase',
  toLowerCase: 'toUpperCase',
  trim: null,
  trimEnd: 'trimStart',
  min: 'max',
  setDate: 'setTime',
  setFullYear: 'setMonth',
  setHours: 'setMinutes',
  setSeconds: 'setMilliseconds',
  setUTCDate: 'setTime',
  setUTCFullYear: 'setUTCMonth',
  setUTCHours: 'setUTCMinutes',
  setUTCSeconds: 'setUTCMilliseconds',
}

const noReverseReplacements = ['getUTCDate', 'setUTCDate']

const replacements = new Map<string, string | null>(Object.entries(baseReplacements))
for (const [key, value] of Object.entries(baseReplacements)) {
  if (value !== null && !noReverseReplacements.includes(key)) {
    replacements.set(value, key)
  }
}

interface NamedMember extends StaticMemberExpression {
  readonly property: IdentifierReference
  readonly object: Expression
}

interface MethodMutation {
  readonly call: CallExpression
  readonly callee: NamedMember
  readonly newName: string | null
}

const methodExpressionMutator: Mutator = (node) =>
  Match.value(node).pipe(
    Match.when(isCallExpression, (call) => methodCallMutants(call)),
    Match.orElse(() => NO_MUTANTS),
  )

function methodCallMutants(call: CallExpression): readonly Node[] {
  return Match.value(methodMutation(call)).pipe(
    Match.when(isMethodMutation, (mutation) => [methodExpressionReplacement(mutation)]),
    Match.orElse(() => NO_MUTANTS),
  )
}

function isMethodMutation(mutation: MethodMutation | undefined): mutation is MethodMutation {
  return mutation !== undefined
}

/** The method this call replaces, or `undefined` when the call is not one this operator knows. */
function methodMutation(call: CallExpression): MethodMutation | undefined {
  const callee = namedMethodCallee(call)
  return Match.value(callee).pipe(
    Match.when(undefined, () => undefined),
    Match.orElse((member) => mutationFor(call, member)),
  )
}

function mutationFor(call: CallExpression, callee: NamedMember): MethodMutation | undefined {
  return Match.value(replacements.get(callee.property.name)).pipe(
    Match.when(undefined, () => undefined),
    Match.orElse((newName) => ({ call, callee, newName })),
  )
}

function namedMethodCallee(call: CallExpression): NamedMember | undefined {
  return Match.value(call.callee).pipe(
    Match.when(isNamedMember, (member) => member),
    Match.orElse(() => undefined),
  )
}

function isNamedMember(node: unknown): node is NamedMember {
  return isMemberProperty(node) && isNotSuperMember(node)
}

function isMemberProperty(node: unknown): node is NamedMember {
  return nodeType(node) === 'MemberExpression' && isIdentifier(propertyOf(node, 'property'))
}

function isNotSuperMember(member: NamedMember): boolean {
  return !isSuperType(member.object)
}

function methodExpressionReplacement(mutation: MethodMutation): Expression {
  return Match.value(mutation.newName).pipe(
    Match.when(null, () => callExpression(cloneNode(mutation.callee.object), [], mutation.callee.optional === true)),
    Match.orElse((newName) => renamedMethodCall(mutation, newName)),
  )
}

function renamedMethodCall(mutation: MethodMutation, newName: string): Expression {
  const mutatedCallee = memberExpression(
    cloneNode(mutation.callee.object),
    identifier(newName),
    mutation.callee.optional === true,
  )
  return callExpression(mutatedCallee, spreadFreeArguments(mutation.call.arguments), mutation.call.optional === true)
}

function spreadFreeArguments(args: ReadonlyArray<Expression | SpreadElement>): Expression[] {
  return args.filter(isNotSpreadElement).map((argument) => cloneNode(argument))
}

function isNotSpreadElement(node: Expression | SpreadElement): node is Expression {
  return node.type !== 'SpreadElement'
}

const objectLiteralMutator: Mutator = (node) =>
  Match.value(node).pipe(
    Match.when(isNonEmptyObjectLiteral, (): readonly Node[] => [{ type: 'ObjectExpression', properties: [] }]),
    Match.orElse(() => NO_MUTANTS),
  )

function isNonEmptyObjectLiteral(node: Node): node is ObjectExpression {
  return node.type === 'ObjectExpression' && node.properties.length > 0
}

const optionalChainingMutator: Mutator = (node) =>
  Match.value(node).pipe(
    Match.when(isOptionalMember, (member) => [withoutOptional(member)]),
    Match.when(isOptionalCall, (call) => [withoutOptional(call)]),
    Match.orElse(() => NO_MUTANTS),
  )

function isOptionalMember(node: Node): node is MemberExpression {
  return node.type === 'MemberExpression' && node.optional === true
}

function isOptionalCall(node: Node): node is CallExpression {
  return node.type === 'CallExpression' && node.optional === true
}

function withoutOptional<T extends Node & { optional?: boolean }>(node: T): T {
  const replacement = cloneNode(node)
  replacement.optional = false
  return replacement
}

type RegexLiteral = Literal & { regex: { pattern: string; flags: string } }

const regexMutator: Mutator = (node, context) =>
  Match.value(node).pipe(
    Match.when(isRegexLiteral, (literal) => regexLiteralMutants(literal)),
    Match.when(isStringLiteral, (literal) =>
      mutantsWhen(isObviousRegexString(literal, context), () => regexConstructorMutants(literal, context))),
    Match.orElse(() =>
      NO_MUTANTS
    ),
  )

function isRegexLiteral(node: Node): node is RegexLiteral {
  return nodeType(node) === 'Literal' && isPresent(propertyOf(node, 'regex'))
}

function regexLiteralMutants(literal: RegexLiteral): readonly Node[] {
  return mutateRegexPattern(literal.regex.pattern, literal.regex.flags).map((pattern) =>
    regExpLiteral(pattern, literal.regex.flags)
  )
}

function regexConstructorMutants(literal: StringLiteral, context: MutatorContext): readonly Node[] {
  return mutateRegexPattern(literal.value, regexFlags(context.parent)).map((pattern) => stringLiteral(pattern))
}

/** A string passed as the first argument of `new RegExp(...)`. */
function isObviousRegexString(node: Node, context: MutatorContext): boolean {
  return isRegExpConstructor(context.parent) && newExpressionArgument(context.parent, 0) === node
}

function isRegExpConstructor(parent: Node | undefined): boolean {
  return isNewExpression(parent) && isRegExpIdentifier(parent.callee)
}

function isNewExpression(node: Node | undefined): node is NewExpression {
  return node?.type === 'NewExpression'
}

function isRegExpIdentifier(node: Node): boolean {
  return node.type === 'Identifier' && node.name === RegExp.name
}

function newExpressionArgument(parent: Node | undefined, index: number): Expression | SpreadElement | undefined {
  return Match.value(parent).pipe(
    Match.when(isNewExpression, (call) => call.arguments[index]),
    Match.orElse(() => undefined),
  )
}

function regexFlags(parent: Node | undefined): string | undefined {
  return Match.value(newExpressionArgument(parent, 1)).pipe(
    Match.when(isStringLiteral, (literal) => literal.value),
    Match.orElse(() => undefined),
  )
}

const PLACEHOLDER = 'Stryker was here!'

const stringLiteralMutator: Mutator = (node, context) =>
  Match.value(node).pipe(
    Match.when(isTemplateLiteral, (template) => templateMutants(template)),
    Match.when(isStringLiteral, (literal) =>
      mutantsWhen(isValidParent(literal, context), () => [
        stringLiteral(replacementText(literal.value.length === 0)),
      ])),
    Match.orElse(() => NO_MUTANTS),
  )

function templateMutants(template: TemplateLiteral): readonly Node[] {
  const first = template.quasis[0]
  if (first === undefined) {
    return NO_MUTANTS
  }
  return [emptyOrPlaceholderTemplate(template, first)]
}

function emptyOrPlaceholderTemplate(template: TemplateLiteral, first: TemplateElement): Node {
  const isEmptyTemplate = [template.quasis.length === 1, first.value.raw.length === 0].every(Boolean)
  return templateLiteral([templateElement(replacementText(isEmptyTemplate))], [])
}

function replacementText(isEmpty: boolean): string {
  if (isEmpty) {
    return PLACEHOLDER
  }
  return ''
}

function isValidParent(child: Node, context: MutatorContext): boolean {
  const parent = context.parent
  return parent === undefined || !isDisallowedParent(parent, child)
}

function isDisallowedParent(parent: Node, child: Node): boolean {
  return [
    isImportExportRelated(parent),
    isJsxOrExpressionRelated(parent),
    isObjectOrClassPropertyKey(parent, child),
    isDisallowedCallExpression(parent),
  ].some(Boolean)
}

const MODULE_KINDS: Readonly<Record<string, true>> = {
  ImportDeclaration: true,
  ExportNamedDeclaration: true,
  ExportDefaultDeclaration: true,
  ExportAllDeclaration: true,
  TSExternalModuleReference: true,
}

function isImportExportRelated(parent: Node): boolean {
  return MODULE_KINDS[parent.type] === true
}

const JSX_KINDS: Readonly<Record<string, true>> = {
  JSXAttribute: true,
  ExpressionStatement: true,
  TSLiteralType: true,
}

function isJsxOrExpressionRelated(parent: Node): boolean {
  return JSX_KINDS[parent.type] === true || isObjectMethod(parent)
}

function isObjectMethod(node: Node): node is ObjectProperty {
  return node.type === 'Property' && node.method === true
}

function isObjectOrClassPropertyKey(parent: Node, child: Node): boolean {
  return isPropertyHost(parent) && isKeyOf(parent, child)
}

function isPropertyHost(node: Node): node is ObjectProperty | PropertyDefinition {
  return node.type === 'Property' || node.type === 'PropertyDefinition'
}

function isKeyOf(host: ObjectProperty | PropertyDefinition, child: Node): boolean {
  return nodeType(host.key) !== undefined && host.key === child
}

const DISALLOWED_CALLEES: Readonly<Record<string, true>> = { require: true, Symbol: true, import: true }

function isDisallowedCallExpression(parent: Node): boolean {
  return isCallExpression(parent) && DISALLOWED_CALLEES[calleeName(parent)] === true
}

function calleeName(parent: CallExpression): string {
  return Match.value(parent.callee).pipe(
    Match.when(isIdentifier, (identifier) => identifier.name),
    Match.when(isImportCallee, () => 'import'),
    Match.orElse(() => ''),
  )
}

type ImportCallee = { readonly type: 'Import' }

function isImportCallee(callee: unknown): callee is ImportCallee {
  return nodeType(callee) === 'Import'
}

const UnaryOperator = {
  '+': '-',
  '-': '+',
  '~': '',
} as const

const UNARY_OPERATOR_KEYS: readonly string[] = Object.keys(UnaryOperator)

type SupportedUnaryExpression = UnaryExpression & { operator: keyof typeof UnaryOperator }

const unaryOperatorMutator: Mutator = (node) =>
  Match.value(node).pipe(
    Match.when(isSupportedUnaryExpression, (unary) => [unaryOperatorReplacement(unary)]),
    Match.orElse(() => NO_MUTANTS),
  )

function isSupportedUnaryExpression(node: Node): node is SupportedUnaryExpression {
  return isPrefixUnaryExpression(node) && isSupportedUnaryOperator(node.operator)
}

function isPrefixUnaryExpression(node: Node): node is UnaryExpression {
  return node.type === 'UnaryExpression' && node.prefix
}

/** The sign-flipping unary becomes a flipped unary; `~x` loses its operator entirely. */
function unaryOperatorReplacement(unary: SupportedUnaryExpression): Expression {
  const mutatedOperator = UnaryOperator[unary.operator]
  return Match.value(mutatedOperator).pipe(
    Match.when(isPlusOrMinus, (operator) => unaryExpression(operator, cloneNode(unary.argument))),
    Match.orElse(() => cloneNode(unary.argument)),
  )
}

function isSupportedUnaryOperator(operator: string): operator is keyof typeof UnaryOperator {
  return UNARY_OPERATOR_KEYS.includes(operator)
}

function isPlusOrMinus(operator: string): operator is '-' | '+' {
  return operator === '-' || operator === '+'
}

const UpdateOperators = {
  '++': '--',
  '--': '++',
} as const

const updateOperatorMutator: Mutator = (node) =>
  Match.value(node).pipe(
    Match.when(isUpdateExpression, (update) => [
      updateExpression(UpdateOperators[update.operator], cloneNode(update.argument), update.prefix),
    ]),
    Match.orElse(() => NO_MUTANTS),
  )

function isUpdateExpression(node: Node): node is UpdateExpression {
  return node.type === 'UpdateExpression'
}

/**
 * Every mutator this instrumenter can apply, named explicitly.
 *
 * This list is deliberately hand-written rather than self-registering. A
 * registry populated by import side effects — each mutator module calling
 * `registerMutator(self)` at module scope — makes the mutant population depend
 * on which imports were evaluated: import order decides the order, a bundler
 * that judges a side-effect-only import unused drops a mutator entirely, and
 * anything reading the array before the last import finished sees a short list.
 * Every one of those failures REMOVES mutants, which RAISES the mutation score,
 * so the tool reports a better number for doing less work and nothing anywhere
 * says so.
 *
 * Naming each mutator here costs one line when a mutator is added and makes
 * that line a compile-checked import instead of a runtime effect.
 *
 * `optInMutators` below follows the same hand-written rule, for the same
 * reason: a mutator exists for a run only when a human named it here.
 */
export const defaultMutators: Readonly<Record<string, Mutator>> = Object.freeze({
  ArithmeticOperator: arithmeticOperatorMutator,
  ArrayDeclaration: arrayDeclarationMutator,
  ArrowFunction: arrowFunctionMutator,
  AssignmentOperator: assignmentOperatorMutator,
  BlockStatement: blockStatementMutator,
  BooleanLiteral: booleanLiteralMutator,
  ConditionalExpression: conditionalExpressionMutator,
  EqualityOperator: equalityOperatorMutator,
  LogicalOperator: logicalOperatorMutator,
  MethodExpression: methodExpressionMutator,
  ObjectLiteral: objectLiteralMutator,
  OptionalChaining: optionalChainingMutator,
  Regex: regexMutator,
  StringLiteral: stringLiteralMutator,
  UnaryOperator: unaryOperatorMutator,
  UpdateOperator: updateOperatorMutator,
})

export const optInMutators: Readonly<Record<string, Mutator>> = Object.freeze({
  AtomicUpdateSplit: atomicUpdateSplitMutator,
  SynchronizationRemoval: synchronizationRemovalMutator,
  FinalizerEscape: finalizerEscapeMutator,
})

export type MutatorEntry = readonly [name: string, mutate: Mutator]

export interface MutatorRegistry {
  readonly defaults: Readonly<Record<string, Mutator>>
  readonly optIn: Readonly<Record<string, Mutator>>
}

export interface MutatorSelection {
  /** Every default, then each opt-in the run named, in the registry's declared order. */
  readonly active: readonly MutatorEntry[]
  /** Every name a `Stryker disable` directive may reference, selected or not. */
  readonly known: readonly string[]
}

/**
 * The entries a run applies, and the names its directives may reference.
 *
 * Naming is additive, never a whitelist: `optInMutations` adds entries on top
 * of the defaults and removes none. Selection walks the registry's declared
 * order, not the order the run listed its names in, so a mutant's identity
 * never depends on how a config happened to spell the list; a name listed
 * twice selects its entry once. An unknown name selects nothing here —
 * `instrument` refuses it before any file is parsed, because a typo that
 * silently enables nothing removes mutants and raises the score.
 *
 * Pure: a registry and a run's names in, entries and names out.
 */
const selectMutatorsDataFirst = (
  registry: MutatorRegistry,
  optInMutations: readonly string[],
): MutatorSelection => ({
  active: [
    ...Object.entries(registry.defaults),
    ...Object.entries(registry.optIn).filter(([name]) => optInMutations.includes(name)),
  ],
  known: [...Object.keys(registry.defaults), ...Object.keys(registry.optIn)],
})

export const selectMutators: {
  (registry: MutatorRegistry, optInMutations: readonly string[]): MutatorSelection
  (optInMutations: readonly string[]): (registry: MutatorRegistry) => MutatorSelection
} = dual((args: IArguments): boolean => args.length >= 2, selectMutatorsDataFirst)
