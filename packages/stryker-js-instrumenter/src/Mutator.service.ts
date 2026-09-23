import { type AST, RegExpParser, visitRegExpAST } from '@eslint-community/regexpp'
import * as Arr from 'effect/Array'
import * as Boolean from 'effect/Boolean'
import * as Context from 'effect/Context'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Layer from 'effect/Layer'
import * as Predicate from 'effect/Predicate'
import * as Result from 'effect/Result'
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
} from '@systemfsoftware/stryker-ignorer-interface'
import type { Location, Position } from './Location.schema.js'
import { LineTable } from './Location.schema.js'
import { Mutant as ApiMutant, MutantNotApplied, MutantSpanMissing } from './Mutant.schema.js'
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
import { printNode } from './print/index.js'

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
const mutateRegexPattern = (pattern: string, flags: string | undefined): readonly string[] =>
  Boolean.match(pattern.length === 0, {
    onTrue: () => [],
    onFalse: () => parseRegexMutants(pattern, orDefault(flags, '')),
  })

const NO_SPLICES: readonly string[] = []

const parseRegexMutants = (pattern: string, flags: string): readonly string[] =>
  Result.getOrElse(
    Result.try({
      try: () => {
        const groups = collectSplices(pattern, flags)
        groups.rest.sort((a, b) => a.start - b.start || a.priority - b.priority)
        return [...groups.bol, ...groups.eol, ...groups.rest].map((splice) => spliceText(pattern, splice))
      },
      catch: () => NO_SPLICES,
    }),
    () => NO_SPLICES,
  )

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

const collectSplices = (pattern: string, flags: string): SpliceGroups => {
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

const collectAssertion = (assertion: AST.Assertion, pattern: string, groups: SpliceGroups): void =>
  Match.value(assertion).pipe(
    Match.when(isEdgeAssertion, (edge) => pushAnchor(edge, pattern, groups)),
    Match.when(isLookaround, (lookaround) => groups.rest.push(lookaroundNegation(lookaround))),
    Match.orElse(() => undefined),
  )

const isEdgeAssertion = (assertion: AST.Assertion): assertion is AST.EdgeAssertion =>
  assertion.kind === 'start' || assertion.kind === 'end'

const isLookaround = (assertion: AST.Assertion): assertion is AST.LookaroundAssertion =>
  assertion.kind === 'lookahead' || assertion.kind === 'lookbehind'

const pushAnchor = (edge: AST.EdgeAssertion, pattern: string, groups: SpliceGroups): void =>
  pushWhen(anchorGroup(edge, groups), anchorRemoval(edge, pattern))

const anchorGroup = (edge: AST.EdgeAssertion, groups: SpliceGroups): Splice[] =>
  Match.value(edge.kind).pipe(
    Match.when('start', () => groups.bol),
    Match.orElse(() => groups.eol),
  )

const lookaroundNegation = (lookaround: AST.LookaroundAssertion): PrioritizedSplice =>
  Match.value(lookaround.kind).pipe(
    Match.when('lookahead', () => lookaroundSplice(lookaround, 2)),
    Match.orElse(() => lookaroundSplice(lookaround, 3)),
  )

const lookaroundSplice = (lookaround: AST.LookaroundAssertion, markerWidth: number): PrioritizedSplice => ({
  start: lookaround.start + markerWidth,
  end: lookaround.start + markerWidth + 1,
  text: negationMarker(lookaround.negate),
  priority: 1,
})

const negationMarker = (negate: boolean): string =>
  Match.value(negate).pipe(
    Match.when(true, () => '='),
    Match.orElse(() => '!'),
  )

const collectCharacterClass = (characterClass: AST.CharacterClass, groups: SpliceGroups): void => {
  const pos = characterClass.start + 1
  groups.rest.push(
    Boolean.match(characterClass.negate, {
      onTrue: () => ({ start: pos, end: pos + 1, text: '', priority: 1 }),
      onFalse: () => ({ start: pos, end: pos, text: '^', priority: 1 }),
    }),
  )
}

const collectCharacterSet = (characterSet: AST.CharacterSet, groups: SpliceGroups): void =>
  pushWhen(groups.rest, characterSetSplice(characterSet))

const characterSetSplice = (characterSet: AST.CharacterSet): PrioritizedSplice | undefined =>
  Match.value(characterSet.kind).pipe(
    Match.when((kind) => NEGATABLE_CHARACTER_SETS[kind] === true, () => classSplice(characterSet)),
    Match.orElse(() => undefined),
  )

const NEGATABLE_CHARACTER_SETS: Readonly<Record<string, true>> = {
  digit: true,
  space: true,
  word: true,
  property: true,
}

const PROPERTY_MARKERS: Readonly<Partial<Record<string, string>>> = { p: 'P', P: 'p' }

const classSplice = (characterSet: AST.CharacterSet): PrioritizedSplice => {
  const pos = characterSet.start + 1
  return { start: pos, end: pos + 1, text: invertedMarker(orDefault(characterSet.raw[1], '')), priority: 2 }
}

const invertedMarker = (marker: string): string =>
  Option.match(Option.fromNullishOr(PROPERTY_MARKERS[marker]), {
    onSome: (propertyMarker) => propertyMarker,
    onNone: () => invertLetterCase(marker),
  })

const invertLetterCase = (letter: string): string =>
  Boolean.match(letter === letter.toUpperCase(), {
    onTrue: () => letter.toLowerCase(),
    onFalse: () => letter.toUpperCase(),
  })

const collectQuantifier = (quantifier: AST.Quantifier, groups: SpliceGroups): void => {
  groups.rest.push({ start: quantifier.start, end: quantifier.end, text: quantifier.element.raw, priority: 0 })
}

const anchorRemoval = (assertion: AST.Assertion, pattern: string): Splice | undefined => {
  const splice = { start: assertion.start, end: assertion.end, text: '' }
  return Option.getOrUndefined(
    Option.filter(Option.some(splice), (candidate) => spliceText(pattern, candidate).length > 0),
  )
}

const pushWhen = <T>(list: T[], splice: T | undefined): void =>
  Option.match(Option.fromNullishOr(splice), {
    onNone: () => undefined,
    onSome: (present) => list.push(present),
  })

const spliceText = (pattern: string, splice: Splice): string =>
  pattern.slice(0, splice.start) + splice.text + pattern.slice(splice.end)

const NO_MUTANTS: readonly Node[] = []

const isPresent = <T>(value: T | null | undefined): value is T => value !== null && value !== undefined

const withOperator = <T extends Node & { operator: string }>(node: T, operator: T['operator']): T => {
  const replacement = cloneNode(node)
  replacement.operator = operator
  return replacement
}

const mutantsWhen = (holds: boolean, build: () => readonly Node[]): readonly Node[] =>
  Match.value(holds).pipe(
    Match.when(true, build),
    Match.orElse(() => NO_MUTANTS),
  )

const hasPropertyIn = <B>(node: object, key: string): node is Record<string, B> => key in node

const readPropertyOf = <B>(node: object, key: string): B | undefined =>
  hasPropertyIn<B>(node, key) ? node[key] : undefined

const propertyOf = <A, B>(node: A, key: string): B | undefined =>
  Predicate.isObject(node) ? readPropertyOf<B>(node, key) : undefined

const isIdentifier = (node: unknown): node is IdentifierReference => nodeType(node) === 'Identifier'

const isCallExpression = (node: Node): node is CallExpression => node.type === 'CallExpression'

const arithmeticOperatorReplacements = Object.freeze({
  '+': '-',
  '-': '+',
  '*': '/',
  '/': '*',
  '%': '*',
} as const)

const ARITHMETIC_OPERATOR_KEYS: readonly string[] = Object.keys(arithmeticOperatorReplacements)

type ArithmeticBinary = BinaryExpression & { operator: keyof typeof arithmeticOperatorReplacements }

const arithmeticOperatorMutator: Mutator = (node) =>
  Match.value(node).pipe(
    Match.when(isArithmeticBinary, (binary) => [withOperator(binary, arithmeticOperatorReplacements[binary.operator])]),
    Match.orElse(() => NO_MUTANTS),
  )

const isArithmeticBinary = (node: Node): node is ArithmeticBinary =>
  isBinaryExpression(node) && isSupportedArithmeticOperator(node.operator, node)

const isBinaryExpression = (node: Node): node is BinaryExpression =>
  node.type === 'BinaryExpression' && !isPrivateInExpression(node)

const isPrivateInExpression = (node: BinaryExpression | PrivateInExpression): node is PrivateInExpression =>
  node.left.type === 'PrivateIdentifier'

const isSupportedArithmeticOperator = (operator: string, node: BinaryExpression): boolean =>
  ARITHMETIC_OPERATOR_KEYS.includes(operator) && !isStringConcatenation(node)

const isStringConcatenation = (node: BinaryExpression): boolean =>
  isStringLike(node.right) || isStringLike(outerLeftOperand(node))

const outerLeftOperand = (node: BinaryExpression): Node => {
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

const isArrayExpression = (node: Node): node is ArrayExpression => node.type === 'ArrayExpression'

const arrayDeclarationReplacement = (array: ArrayExpression): Expression =>
  Boolean.match(array.elements.length > 0, {
    onTrue: () => arrayExpression([]),
    onFalse: () => arrayExpression([stringLiteral('Stryker was here')]),
  })

const isArrayConstructorCall = (node: Node): node is ArrayConstructorCall =>
  isCallOrNewExpression(node) && isArrayIdentifier(node.callee)

const isCallOrNewExpression = (node: Node): node is CallExpression | NewExpression =>
  node.type === 'CallExpression' || node.type === 'NewExpression'

const isArrayIdentifier = (node: Node): node is IdentifierReference & { name: 'Array' } =>
  node.type === 'Identifier' && node.name === 'Array'

const arrayConstructorReplacement = (construct: ArrayConstructorCall): Expression => {
  const mutatedCallArgs = constructorArguments(construct.arguments)
  return Boolean.match(construct.type === 'NewExpression', {
    onTrue: () => newExpression(cloneNode(construct.callee), mutatedCallArgs),
    onFalse: () => callExpression(cloneNode(construct.callee), mutatedCallArgs),
  })
}

const constructorArguments = (args: ReadonlyArray<Expression | SpreadElement>): Expression[] =>
  Boolean.match(args.length > 0, {
    onTrue: () => [],
    onFalse: () => [arrayExpression([])],
  })

const arrowFunctionMutator: Mutator = (node) =>
  Match.value(node).pipe(
    Match.when(isExpressionBodiedArrow, () => [arrowFunctionExpression([], identifier('undefined'))]),
    Match.orElse(() => NO_MUTANTS),
  )

const isExpressionBodiedArrow = (node: Node): node is ArrowFunctionExpression =>
  node.type === 'ArrowFunctionExpression' && hasMutableArrowBody(node.body)

const hasMutableArrowBody = (body: BlockStatement | Expression): boolean =>
  body.type !== 'BlockStatement' && !isUndefinedExpression(body)

const isUndefinedExpression = (node: BlockStatement | Expression): node is IdentifierReference =>
  node.type === 'Identifier' && node.name === 'undefined'

const assignmentOperatorReplacements = Object.freeze({
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
} as const)

const isStringLike = (value: unknown): value is TemplateLiteral | StringLiteral =>
  isTemplateLiteral(value) || isStringLiteral(value)

const isTemplateLiteral = (value: unknown): value is TemplateLiteral => nodeType(value) === 'TemplateLiteral'

const isStringLiteral = (value: unknown): value is StringLiteral =>
  nodeType(value) === 'Literal' && hasStringValue(value)

const hasStringValue = <A>(value: A): boolean =>
  Predicate.hasProperty(value, 'value') && typeof value['value'] === 'string'

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

const isMutatableAssignment = (node: Node): node is AssignmentBinary =>
  node.type === 'AssignmentExpression' && isSupportedAssignment(node)

const isSupportedAssignment = (node: AssignmentExpression): boolean =>
  ASSIGNMENT_OPERATOR_KEYS.includes(node.operator) && isSupportedAssignmentExpression(node)

const isSupportedAssignmentExpression = (node: AssignmentExpression): boolean =>
  !isStringLike(node.right) || stringAssignmentTypes.includes(node.operator)

const blockStatementMutator: Mutator = (node, context) =>
  mutantsWhen(isMutableBlock(node, context), () => [blockStatement([])])

const isMutableBlock = (node: Node, context: MutatorContext): boolean =>
  node.type === 'BlockStatement' && isValid(node, context)

const isValid = (node: BlockStatement, context: MutatorContext): boolean =>
  !isEmpty(node) && !isInvalidConstructorBody(node, context)

const isEmpty = (node: BlockStatement): boolean => node.body.length === 0

const isInvalidConstructorBody = (block: BlockStatement, context: MutatorContext): boolean => {
  const parent = context.parent
  return isConstructorMethod(parent) && constructorBodyMatters(block, parent, context)
}

const isConstructorMethod = (node: Node | undefined): node is MethodDefinition =>
  isMethodDefinition(node) && node.kind === 'constructor'

const isMethodDefinition = (node: Node | undefined): node is MethodDefinition => node?.type === 'MethodDefinition'

const constructorBodyMatters = (
  block: BlockStatement,
  constructor: MethodDefinition,
  context: MutatorContext,
): boolean => containsSuperCall(block) && hasConstructorInitialization(constructor, context)

const hasConstructorInitialization = (constructor: MethodDefinition, context: MutatorContext): boolean =>
  [constructor.value.params.some(isParameterProperty), hasInitializedProperties(context)].some(Boolean)

type ParameterProperty = { readonly type: 'TSParameterProperty' }

const isParameterProperty = (param: unknown): param is ParameterProperty =>
  nodeType(param) === 'TSParameterProperty'

const hasInitializedProperties = (context: MutatorContext): boolean => {
  const classBody = context.grandParent
  return isClassBody(classBody) && classBody.body.some(isInitializedField)
}

const isClassBody = (node: Node | undefined): node is ClassBody => node?.type === 'ClassBody'

const isInitializedField = (member: Node): boolean => isPropertyDefinition(member) && isPresent(member.value)

const isPropertyDefinition = (node: Node): node is PropertyDefinition => node.type === 'PropertyDefinition'

const isSuperType = <A>(node: A): boolean => Predicate.hasProperty(node, 'type') && node['type'] === 'Super'

const isSuperCallExpression = <A>(node: A): boolean =>
  nodeType(node) === 'CallExpression' && isSuperType(propertyOf(node, 'callee'))

const containsSuperCall = <A>(node: A): boolean => isObjectLike(node) && containsSuperIn(node)

const isObjectLike = (value: unknown): value is object => typeof value === 'object' && value !== null

const containsSuperIn = (node: object): boolean => isSuperReference(node) || hasSuperInChildren(node)

const isSuperReference = <A>(node: A): boolean => isSuperType(node) || isSuperCallExpression(node)

const hasSuperInChildren = (node: object): boolean =>
  Object.keys(node).some((key) => containsSuperInValue(propertyOf(node, key)))

const containsSuperInValue = (value: unknown): boolean =>
  Match.value(value).pipe(
    Match.when(Predicate.isArray, (items) => items.some(containsSuperCall)),
    Match.orElse(containsSuperCall),
  )

const booleanLiteralMutator: Mutator = (node) =>
  Match.value(node).pipe(
    Match.when(isBooleanLiteral, (literal) => [booleanLiteral(!literal.value)]),
    Match.when(isNegatedPrefix, (unary) => [cloneNode(unary.argument)]),
    Match.orElse(() => NO_MUTANTS),
  )

const isBooleanLiteral = (node: Node): node is BooleanLiteral =>
  node.type === 'Literal' && typeof node.value === 'boolean'

const isNegatedPrefix = (node: Node): node is UnaryExpression => isUnaryExpression(node) && isNegation(node)

const isUnaryExpression = (node: Node): node is UnaryExpression => node.type === 'UnaryExpression'

type NegatedPrefix = UnaryExpression & { operator: '!' }

const isNegation = (unary: UnaryExpression): unary is NegatedPrefix => unary.operator === '!' && unary.prefix

const booleanOperators = Object.freeze(['!=', '!==', '&&', '<', '<=', '==', '===', '>', '>=', '||'])

const conditionalExpressionMutator: Mutator = (node, context) =>
  Match.value(isTestOfLoop(node, context)).pipe(
    Match.when(true, () => [booleanLiteral(false)]),
    Match.orElse(() => conditionTestMutants(node, context)),
  )

const conditionTestMutants = (node: Node, context: MutatorContext): readonly Node[] =>
  Match.value(isTestOfCondition(node, context)).pipe(
    Match.when(true, () => [booleanLiteral(true), booleanLiteral(false)]),
    Match.orElse(() => booleanExpressionMutants(node, context)),
  )

const booleanExpressionMutants = (node: Node, context: MutatorContext): readonly Node[] =>
  Match.value(isBooleanExpression(node)).pipe(
    Match.when(true, () => booleanExpressionReplacements(context)),
    Match.orElse(() => statementMutants(node)),
  )

const statementMutants = (node: Node): readonly Node[] =>
  Match.value(node).pipe(
    Match.when(isEmptyTestForStatement, (loop) => [withEmptyTest(loop)]),
    Match.when(isNonEmptySwitchCase, (switchCase) => [withEmptyConsequent(switchCase)]),
    Match.orElse(() => NO_MUTANTS),
  )

const withEmptyTest = (loop: ForStatement): ForStatement => {
  const replacement = cloneNode(loop)
  replacement.test = booleanLiteral(false)
  return replacement
}

const withEmptyConsequent = (switchCase: SwitchCase): SwitchCase => {
  const replacement = cloneNode(switchCase)
  replacement.consequent = []
  return replacement
}

const isEmptyTestForStatement = (node: Node): node is ForStatement =>
  node.type === 'ForStatement' && node.test === null

const isNonEmptySwitchCase = (node: Node): node is SwitchCase =>
  node.type === 'SwitchCase' && node.consequent.length > 0

const booleanExpressionReplacements = (context: MutatorContext): readonly Node[] =>
  Match.value(logicalParentOperator(context.parent)).pipe(
    Match.when('&&', () => [booleanLiteral(true)]),
    Match.when('||', () => [booleanLiteral(false)]),
    Match.orElse(() => [booleanLiteral(true), booleanLiteral(false)]),
  )

const logicalParentOperator = (parent: Node | undefined): string | undefined =>
  Match.value(parent).pipe(
    Match.when(isLogicalExpression, (logical) => logical.operator),
    Match.orElse(() => undefined),
  )

const isLogicalExpression = (node: Node | undefined): node is LogicalExpression => node?.type === 'LogicalExpression'

const isTestOfLoop = (node: Node, context: MutatorContext): boolean =>
  isLoopStatement(context.parent) && testOfStatement(context.parent) === node

const isTestOfCondition = (node: Node, context: MutatorContext): boolean =>
  isIfStatement(context.parent) && testOfStatement(context.parent) === node

const isLoopStatement = (node: Node | undefined): boolean =>
  isTestBearingStatement(node) && LOOP_STATEMENT_KINDS[node.type] === true

const isIfStatement = (node: Node | undefined): node is IfStatement => node?.type === 'IfStatement'

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

const isTestBearingStatement = (node: Node | undefined): node is TestBearingStatement =>
  node !== undefined && TEST_BEARING_KINDS[node.type] === true

const testOfStatement = (node: Node | undefined): Node | undefined =>
  Match.value(node).pipe(
    Match.when(isTestBearingStatement, (statement) => statement.test ?? undefined),
    Match.orElse(() => undefined),
  )

const isBooleanExpression = (node: Node): node is BinaryExpression | LogicalExpression =>
  isOperatorExpression(node) && booleanOperators.includes(node.operator)

const isOperatorExpression = (node: Node): node is BinaryExpression | LogicalExpression =>
  node.type === 'BinaryExpression' || node.type === 'LogicalExpression'

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

const isEqualityBinary = (node: Node): node is EqualityBinary =>
  node.type === 'BinaryExpression' && EQUALITY_OPERATOR_KEYS.includes(node.operator)

const mutatedEqualityOperators = (binary: EqualityBinary): readonly Node[] =>
  operators[binary.operator].map((operator) => withOperator(binary, operator))

const logicalOperatorReplacements = Object.freeze({
  '&&': '||',
  '||': '&&',
  '??': '&&',
} as const)

const LOGICAL_OPERATOR_KEYS: readonly string[] = Object.keys(logicalOperatorReplacements)

type LogicalBinary = LogicalExpression & { operator: keyof typeof logicalOperatorReplacements }

const logicalOperatorMutator: Mutator = (node) =>
  Match.value(node).pipe(
    Match.when(isSupportedLogicalOperator, (binary) => [
      withOperator(binary, logicalOperatorReplacements[binary.operator]),
    ]),
    Match.orElse(() => NO_MUTANTS),
  )

const isSupportedLogicalOperator = (node: Node): node is LogicalBinary =>
  node.type === 'LogicalExpression' && LOGICAL_OPERATOR_KEYS.includes(node.operator)

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

const replacements = new Map<string, string | null>([
  ...Object.entries(baseReplacements),
  ...Object.entries(baseReplacements)
    .filter((entry): entry is [string, string] => entry[1] !== null && !noReverseReplacements.includes(entry[0]))
    .map(([key, value]) => [value, key] as const),
])

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

const methodCallMutants = (call: CallExpression): readonly Node[] =>
  Match.value(methodMutation(call)).pipe(
    Match.when(isMethodMutation, (mutation) => [methodExpressionReplacement(mutation)]),
    Match.orElse(() => NO_MUTANTS),
  )

const isMethodMutation = (mutation: MethodMutation | undefined): mutation is MethodMutation =>
  mutation !== undefined

const methodMutation = (call: CallExpression): MethodMutation | undefined => {
  const callee = namedMethodCallee(call)
  return Match.value(callee).pipe(
    Match.when(undefined, () => undefined),
    Match.orElse((member) => mutationFor(call, member)),
  )
}

const mutationFor = (call: CallExpression, callee: NamedMember): MethodMutation | undefined =>
  Match.value(replacements.get(callee.property.name)).pipe(
    Match.when(undefined, () => undefined),
    Match.orElse((newName) => ({ call, callee, newName })),
  )

const namedMethodCallee = (call: CallExpression): NamedMember | undefined =>
  Match.value(call.callee).pipe(
    Match.when(isNamedMember, (member) => member),
    Match.orElse(() => undefined),
  )

const isNamedMember = (node: unknown): node is NamedMember => isMemberProperty(node) && isNotSuperMember(node)

const isMemberProperty = (node: unknown): node is NamedMember =>
  nodeType(node) === 'MemberExpression' && isIdentifier(propertyOf(node, 'property'))

const isNotSuperMember = (member: NamedMember): boolean => !isSuperType(member.object)

const methodExpressionReplacement = (mutation: MethodMutation): Expression =>
  Match.value(mutation.newName).pipe(
    Match.when(null, () =>
      callExpression(cloneNode(mutation.callee.object), [], mutation.callee.optional === true)),
    Match.orElse((newName) => renamedMethodCall(mutation, newName)),
  )

const renamedMethodCall = (mutation: MethodMutation, newName: string): Expression => {
  const mutatedCallee = memberExpression(
    cloneNode(mutation.callee.object),
    identifier(newName),
    mutation.callee.optional === true,
  )
  return callExpression(mutatedCallee, spreadFreeArguments(mutation.call.arguments), mutation.call.optional === true)
}

const spreadFreeArguments = (args: ReadonlyArray<Expression | SpreadElement>): Expression[] =>
  args.filter(isNotSpreadElement).map((argument) => cloneNode(argument))

const isNotSpreadElement = (node: Expression | SpreadElement): node is Expression =>
  node.type !== 'SpreadElement'

const objectLiteralMutator: Mutator = (node) =>
  Match.value(node).pipe(
    Match.when(isNonEmptyObjectLiteral, (): readonly Node[] => [{ type: 'ObjectExpression', properties: [] }]),
    Match.orElse(() => NO_MUTANTS),
  )

const isNonEmptyObjectLiteral = (node: Node): node is ObjectExpression =>
  node.type === 'ObjectExpression' && node.properties.length > 0

const optionalChainingMutator: Mutator = (node) =>
  Match.value(node).pipe(
    Match.when(isOptionalMember, (member) => [withoutOptional(member)]),
    Match.when(isOptionalCall, (call) => [withoutOptional(call)]),
    Match.orElse(() => NO_MUTANTS),
  )

const isOptionalMember = (node: Node): node is MemberExpression =>
  node.type === 'MemberExpression' && node.optional === true

const isOptionalCall = (node: Node): node is CallExpression => node.type === 'CallExpression' && node.optional === true

const withoutOptional = <T extends Node & { optional?: boolean }>(node: T): T => {
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

const isRegexLiteral = (node: Node): node is RegexLiteral =>
  nodeType(node) === 'Literal' && isPresent(propertyOf(node, 'regex'))

const regexLiteralMutants = (literal: RegexLiteral): readonly Node[] =>
  mutateRegexPattern(literal.regex.pattern, literal.regex.flags).map((pattern) =>
    regExpLiteral(pattern, literal.regex.flags)
  )

const regexConstructorMutants = (literal: StringLiteral, context: MutatorContext): readonly Node[] =>
  mutateRegexPattern(literal.value, regexFlags(context.parent)).map((pattern) => stringLiteral(pattern))

/** A string passed as the first argument of `new RegExp(...)`. */
const isObviousRegexString = (node: Node, context: MutatorContext): boolean =>
  isRegExpConstructor(context.parent) && newExpressionArgument(context.parent, 0) === node

const isRegExpConstructor = (parent: Node | undefined): boolean =>
  isNewExpression(parent) && isRegExpIdentifier(parent.callee)

const isNewExpression = (node: Node | undefined): node is NewExpression => node?.type === 'NewExpression'

const isRegExpIdentifier = (node: Node): boolean => node.type === 'Identifier' && node.name === RegExp.name

const newExpressionArgument = (
  parent: Node | undefined,
  index: number,
): Expression | SpreadElement | undefined =>
  Match.value(parent).pipe(
    Match.when(isNewExpression, (call) => call.arguments[index]),
    Match.orElse(() => undefined),
  )

const regexFlags = (parent: Node | undefined): string | undefined =>
  Match.value(newExpressionArgument(parent, 1)).pipe(
    Match.when(isStringLiteral, (literal) => literal.value),
    Match.orElse(() => undefined),
  )

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

const templateMutants = (template: TemplateLiteral): readonly Node[] =>
  Option.match(Option.fromNullishOr(template.quasis[0]), {
    onNone: () => NO_MUTANTS,
    onSome: (first) => [emptyOrPlaceholderTemplate(template, first)],
  })

const emptyOrPlaceholderTemplate = (template: TemplateLiteral, first: TemplateElement): Node => {
  const isEmptyTemplate = [template.quasis.length === 1, first.value.raw.length === 0].every(Boolean)
  return templateLiteral([templateElement(replacementText(isEmptyTemplate))], [])
}

const replacementText = (isEmpty: boolean): string =>
  Boolean.match(isEmpty, {
    onTrue: () => PLACEHOLDER,
    onFalse: () => '',
  })

const isValidParent = (child: Node, context: MutatorContext): boolean => {
  const parent = context.parent
  return parent === undefined || !isDisallowedParent(parent, child)
}

const isDisallowedParent = (parent: Node, child: Node): boolean =>
  [
    isImportExportRelated(parent),
    isJsxOrExpressionRelated(parent),
    isObjectOrClassPropertyKey(parent, child),
    isDisallowedCallExpression(parent),
  ].some(Boolean)

const MODULE_KINDS: Readonly<Record<string, true>> = {
  ImportDeclaration: true,
  ExportNamedDeclaration: true,
  ExportDefaultDeclaration: true,
  ExportAllDeclaration: true,
  TSExternalModuleReference: true,
}

const isImportExportRelated = (parent: Node): boolean => MODULE_KINDS[parent.type] === true

const JSX_KINDS: Readonly<Record<string, true>> = {
  JSXAttribute: true,
  ExpressionStatement: true,
  TSLiteralType: true,
}

const isJsxOrExpressionRelated = (parent: Node): boolean => JSX_KINDS[parent.type] === true || isObjectMethod(parent)

const isObjectMethod = (node: Node): node is ObjectProperty => node.type === 'Property' && node.method === true

const isObjectOrClassPropertyKey = (parent: Node, child: Node): boolean =>
  isPropertyHost(parent) && isKeyOf(parent, child)

const isPropertyHost = (node: Node): node is ObjectProperty | PropertyDefinition =>
  node.type === 'Property' || node.type === 'PropertyDefinition'

const isKeyOf = (host: ObjectProperty | PropertyDefinition, child: Node): boolean =>
  nodeType(host.key) !== undefined && host.key === child

const DISALLOWED_CALLEES: Readonly<Record<string, true>> = { require: true, Symbol: true, import: true }

const isDisallowedCallExpression = (parent: Node): boolean =>
  isCallExpression(parent) && DISALLOWED_CALLEES[calleeName(parent)] === true

const calleeName = (parent: CallExpression): string =>
  Match.value(parent.callee).pipe(
    Match.when(isIdentifier, (identifier) => identifier.name),
    Match.when(isImportCallee, () => 'import'),
    Match.orElse(() => ''),
  )

type ImportCallee = { readonly type: 'Import' }

const isImportCallee = (callee: unknown): callee is ImportCallee => nodeType(callee) === 'Import'

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

const isSupportedUnaryExpression = (node: Node): node is SupportedUnaryExpression =>
  isPrefixUnaryExpression(node) && isSupportedUnaryOperator(node.operator)

const isPrefixUnaryExpression = (node: Node): node is UnaryExpression =>
  node.type === 'UnaryExpression' && node.prefix

const unaryOperatorReplacement = (unary: SupportedUnaryExpression): Expression => {
  const mutatedOperator = UnaryOperator[unary.operator]
  return Match.value(mutatedOperator).pipe(
    Match.when(isPlusOrMinus, (operator) => unaryExpression(operator, cloneNode(unary.argument))),
    Match.orElse(() => cloneNode(unary.argument)),
  )
}

const isSupportedUnaryOperator = (operator: string): operator is keyof typeof UnaryOperator =>
  UNARY_OPERATOR_KEYS.includes(operator)

const isPlusOrMinus = (operator: string): operator is '-' | '+' => operator === '-' || operator === '+'

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

const isUpdateExpression = (node: Node): node is UpdateExpression => node.type === 'UpdateExpression'

export interface MutatorsShape {
  readonly mutators: Readonly<Record<string, Mutator>>
  readonly create: (options: CreateMutantOptions) => Mutant
  readonly apply: (mutant: Mutant, originalTree: Node) => Result.Result<Node, MutantNotApplied>
  readonly toApi: (mutant: Mutant) => Result.Result<ApiMutant, MutantSpanMissing>
}

export class Mutators
  extends Context.Service<Mutators, MutatorsShape>()('@systemfsoftware/stryker-js-instrumenter/Mutator.service/Mutators')
{
  static readonly layer: Layer.Layer<Mutators> = Layer.succeed(Mutators, {
    mutators: Object.freeze({
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
    }),
    create: createMutant,
    apply: applyMutant,
    toApi: toApiMutant,
  })
}
