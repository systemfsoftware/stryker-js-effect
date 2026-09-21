import type { Ignorer } from '@systemfsoftware/stryker-ignorer-interface'
import * as Effect from 'effect/Effect'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Predicate from 'effect/Predicate'
import {
  type ArrowFunctionExpression,
  arrowFunctionExpression,
  attachComments,
  blockStatement,
  buildLineTable,
  callExpression,
  type ClassExpression,
  cloneNode,
  type Comment,
  conditionalExpression,
  type Expression,
  expressionStatement,
  type FunctionExpression,
  identifier,
  type IdentifierReference,
  ifStatement,
  isExpressionKind,
  isStatementKind,
  type MemberExpression,
  type Node,
  nodeType,
  positionFromLineTable,
  type Program,
  returnStatement,
  sequenceExpression,
  spanOf,
  type Statement,
  stringLiteral,
  switchCase,
  traverse,
  type TraversePath,
  variableDeclaration,
  type VariableDeclarator,
  variableDeclarator,
} from './Ast.js'
import { type MutateDescription, type Position } from './Instrument.schema.js'
import { INSTRUMENTER_CONSTANTS as ID } from './Mutant.js'
import { applyMutant, createMutant, type Mutable, type Mutant } from './Mutator.js'
import { type MutatorContext, type MutatorOptions } from './Mutator.js'
import { allMutators } from './Mutator.js'
import { type ParseFailed, parseWithOxc } from './Parser.js'
import {
  type Ast,
  type AstByFormat,
  AstFormat,
  locationIncluded,
  locationOverlaps,
  type ScriptFormat,
  type SourceLocationInFile,
} from './Syntax.js'
import { PlacementFailed, TransformFailed } from './Transformer.schema.js'
export { PlacementFailed, TransformFailed }

const STRYKER_NAMESPACE_HELPER = 'stryNS_9fa48'
const COVER_MUTANT_HELPER = 'stryCov_9fa48'
const IS_MUTANT_ACTIVE_HELPER = 'stryMutAct_9fa48'

export interface TransformerOptions extends MutatorOptions {
  ignorers: readonly Ignorer[]
}
export type MutantCollector = Mutant[]

export function createMutantCollector(): MutantCollector {
  return []
}

export function collect(
  collector: MutantCollector,
  fileName: string,
  original: Node,
  mutable: Mutable,
  offset?: Position,
  lineTable?: readonly number[],
): Mutant {
  const mutant = createMutant(
    collector.length.toString(),
    fileName,
    original,
    mutable,
    offset,
    lineTable,
  )
  collector.push(mutant)
  return mutant
}

export function hasPlacedMutants(
  collector: readonly Mutant[],
  fileName: string,
): boolean {
  return collector.some(
    (mutant) => mutant.fileName === fileName && mutant.ignoreReason === undefined,
  )
}

const WILDCARD = 'all'
const DEFAULT_REASON = 'Ignored using a comment'
const NO_CHILDREN: readonly unknown[] = Object.freeze([])

const strykerCommentDirectiveRegex = /^\s?Stryker (disable|restore)(?: (next-line))? ([a-zA-Z, ]+)(?::(.+)?)?/

export type Rule =
  | { readonly kind: 'Root' }
  | {
    readonly kind: 'Ignore'
    readonly mutatorNames: readonly string[]
    readonly line: number | undefined
    readonly ignoreReason: string
    readonly previous: Rule
  }
  | {
    readonly kind: 'Restore'
    readonly mutatorNames: readonly string[]
    readonly line: number | undefined
    readonly previous: Rule
  }

export const rootRule: Rule = { kind: 'Root' }

type IgnoreRule = Extract<Rule, { kind: 'Ignore' }>
type RestoreRule = Extract<Rule, { kind: 'Restore' }>

export function findIgnoreReason(
  rule: Rule,
  mutatorName: string,
  line: number,
): string | undefined {
  return Option.getOrUndefined(ignoreReasonIn(rule, mutatorName.toLowerCase(), line))
}

function ignoreReasonIn(
  rule: Rule,
  lowerMutatorName: string,
  line: number,
): Option.Option<string> {
  return Match.value(rule).pipe(
    Match.when({ kind: 'Ignore' }, (ignore) => directiveOutcome(ignore, lowerMutatorName, line)),
    Match.when({ kind: 'Restore' }, (restore) => directiveOutcome(restore, lowerMutatorName, line)),
    Match.when({ kind: 'Root' }, () => Option.none<string>()),
    Match.exhaustive,
  )
}

function directiveOutcome(
  directive: IgnoreRule | RestoreRule,
  lowerMutatorName: string,
  line: number,
): Option.Option<string> {
  return Match.value(directiveApplies(directive, lowerMutatorName, line)).pipe(
    Match.when(false, () => ignoreReasonIn(directive.previous, lowerMutatorName, line)),
    Match.when(true, () =>
      Match.value(directive).pipe(
        Match.when({ kind: 'Ignore' }, (ignore) => Option.some(ignore.ignoreReason)),
        Match.when({ kind: 'Restore' }, () => Option.none<string>()),
        Match.exhaustive,
      )),
    Match.exhaustive,
  )
}

/** A directive applies when its line — where it declares one — and one of its mutator names match. */
function directiveApplies(
  directive: IgnoreRule | RestoreRule,
  lowerMutatorName: string,
  line: number,
): boolean {
  return Option.match(Option.fromNullishOr(directive.line), {
    onNone: () => true,
    onSome: (directiveLine) => directiveLine === line,
  }) && directive.mutatorNames.some((name) => name === lowerMutatorName || name === WILDCARD)
}

interface LocatedComment extends Comment {
  readonly loc?: {
    readonly start: { readonly line: number; readonly column: number }
    readonly end: { readonly line: number; readonly column: number }
  }
}

interface StrykerDirective {
  readonly type: string
  readonly scope: string | undefined
  readonly mutatorNames: readonly string[]
  readonly reason: string
  readonly loc: LocatedComment['loc']
}

interface NodeWithLeadingComments {
  readonly leadingComments?: readonly LocatedComment[]
}

const NO_COMMENTS: readonly LocatedComment[] = []
const PARSE_FAILURE = 'Stryker directive without directive type or mutators'
const MISSING_LOCATION = 'Comment without location'

export function processStrykerDirectives(
  rule: Rule,
  node: Node,
  allMutatorNames: readonly string[],
  originFileName: string,
): { rule: Rule; warnings: readonly string[] } {
  const directives = attachedComments(node).map(parseStrykerDirective).flatMap(Option.toArray)
  const warnings = directives.flatMap((directive) => mutatorWarnings(directive, allMutatorNames, originFileName))
  return { rule: directives.reduce(applyStrykerDirective, rule), warnings }
}

function attachedComments(node: Node): readonly LocatedComment[] {
  return leadingCommentsOn(node) ?? NO_COMMENTS
}

function leadingCommentsOn(value: unknown): readonly LocatedComment[] | undefined {
  if (isCommentBearing(value)) return value.leadingComments
  return undefined
}

function isCommentBearing(value: unknown): value is NodeWithLeadingComments {
  return Predicate.hasProperty(value, 'leadingComments')
}

/** A comment that matched the directive grammar, decoded into the fields a rule needs. */
function parseStrykerDirective(comment: LocatedComment): Option.Option<StrykerDirective> {
  return Option.map(
    Option.fromNullishOr(strykerCommentDirectiveRegex.exec(comment.value)),
    (match) => strykerDirective(match, comment.loc),
  )
}

function strykerDirective(match: RegExpExecArray, loc: LocatedComment['loc']): StrykerDirective {
  return {
    type: matchGroup(match, 1),
    scope: match[2],
    mutatorNames: matchGroup(match, 3).split(',').map((mutator) => mutator.trim()),
    reason: (match[4] ?? DEFAULT_REASON).trim(),
    loc,
  }
}

function matchGroup(match: RegExpExecArray, group: number): string {
  return Option.getOrThrowWith(Option.fromNullishOr(match[group]), () => new Error(PARSE_FAILURE))
}

function applyStrykerDirective(rule: Rule, directive: StrykerDirective): Rule {
  return Match.value(directive.type).pipe(
    Match.when('disable', () => ignoreRuleFor(rule, directive)),
    Match.when('restore', () => restoreRuleFor(rule, directive)),
    Match.orElse(() => rule),
  )
}

function ignoreRuleFor(rule: Rule, directive: StrykerDirective): Rule {
  return {
    kind: 'Ignore',
    mutatorNames: directive.mutatorNames.map((mutatorName) => mutatorName.toLowerCase()),
    line: directiveLine(directive),
    ignoreReason: directive.reason,
    previous: rule,
  }
}

function restoreRuleFor(rule: Rule, directive: StrykerDirective): Rule {
  return {
    kind: 'Restore',
    mutatorNames: directive.mutatorNames.map((mutatorName) => mutatorName.toLowerCase()),
    line: directiveLine(directive),
    previous: rule,
  }
}

/** `next-line` directives carry the line they were written on; a block directive carries none. */
function directiveLine(directive: StrykerDirective): number | undefined {
  return Match.value(directive.scope).pipe(
    Match.when('next-line', () => commentLocation(directive.loc).start.line),
    Match.orElse(() => undefined),
  )
}

function commentLocation(loc: LocatedComment['loc']): NonNullable<LocatedComment['loc']> {
  return Option.getOrThrowWith(Option.fromNullishOr(loc), () => new Error(MISSING_LOCATION))
}

/** Warnings for the directive's mutator names that the configured mutators do not know. */
function mutatorWarnings(
  directive: StrykerDirective,
  allMutatorNames: readonly string[],
  originFileName: string,
): readonly string[] {
  return directive.mutatorNames
    .filter((mutatorName) => mutatorName !== WILDCARD)
    .filter((mutatorName) => !allMutatorNames.includes(mutatorName.toLowerCase()))
    .map((mutatorName) => mutatorWarning(directive, mutatorName, originFileName))
}

function mutatorWarning(directive: StrykerDirective, mutatorName: string, originFileName: string): string {
  const loc = commentLocation(directive.loc)
  const label = Option.match(Option.filter(Option.fromNullishOr(directive.scope), (scope) => scope !== ''), {
    onNone: () => directive.type,
    onSome: (scope) => `${directive.type} ${scope}`,
  })
  return `Unused 'Stryker ${label}' directive. Mutator with name '${mutatorName}' not found. Directive found at: ${originFileName}:${loc.start.line}:${loc.start.column}.`
}

function ancestorsOf(path: TraversePath): Node[] {
  const ancestors: Node[] = []
  for (let current = path.parentPath; current !== null; current = current.parentPath) {
    ancestors.push(current.node)
  }
  return ancestors
}

export function isTypeNode(path: TraversePath): boolean {
  return [
    tsTypeAnnotationNodeTypes.includes(path.node.type),
    flowTypeAnnotationNodeTypes.includes(path.node.type),
    isDeclareVariableStatement(path.node),
    isDeclareModule(path.node),
  ].some((isType) => isType)
}

function isDeclareVariableStatement(node: Node): boolean {
  return isDeclared(node) && nodeType(node) === 'VariableDeclaration'
}

function isDeclareModule(node: Node): boolean {
  return isDeclared(node) && nodeType(node) === 'TSModuleDeclaration'
}

function isDeclared(node: Node): boolean {
  return 'declare' in node && node.declare === true
}

const tsTypeAnnotationNodeTypes: ReadonlyArray<string> = Object.freeze([
  'TSInterfaceDeclaration',
  'TSTypeAnnotation',
  'TSTypeAliasDeclaration',
  'TSEnumDeclaration',
  'TSDeclareFunction',
  'TSTypeParameterInstantiation',
  'TSTypeParameterDeclaration',
])

const flowTypeAnnotationNodeTypes: ReadonlyArray<string> = Object.freeze([
  'DeclareClass',
  'DeclareFunction',
  'DeclareInterface',
  'DeclareModule',
  'DeclareModuleExports',
  'DeclareTypeAlias',
  'DeclareOpaqueType',
  'DeclareVariable',
  'DeclareExportDeclaration',
  'DeclareExportAllDeclaration',
  'InterfaceDeclaration',
  'OpaqueType',
  'TypeAlias',
])

export function isImportDeclaration(path: TraversePath): boolean {
  return (
    nodeType(path.node) === 'TSImportEqualsDeclaration' || path.node.type === 'ImportDeclaration'
  )
}

export function mutantTestExpression(
  mutantId: string,
): Expression {
  return callExpression(identifier(IS_MUTANT_ACTIVE_HELPER), [stringLiteral(mutantId)])
}

export function mutationCoverageSequenceExpression(
  mutants: Iterable<Mutant>,
  targetExpression?: Expression,
): Expression {
  const mutantIds = [...mutants].map((mutant) => stringLiteral(mutant.id))
  const sequence: Expression[] = [
    callExpression(identifier(COVER_MUTANT_HELPER), mutantIds),
  ]
  if (targetExpression) {
    sequence.push(targetExpression)
  }
  return sequenceExpression(sequence)
}

export interface MutantPlacer {
  name: string
  canPlace(path: TraversePath): boolean
  place(path: TraversePath, appliedMutants: Map<Mutant, Node>): void
}

export function nodeOfKind<T extends Node>(
  mutant: Mutant,
  node: Node,
  isKind: (candidate: Node) => candidate is T,
  kind: string,
): T {
  return narrowNode(node, isKind, `Cannot place mutant ${mutant.id}: expected ${kind}, got ${node.type}`)
}

function narrowNode<T extends Node>(
  node: Node,
  isKind: (candidate: Node) => candidate is T,
  message: string,
): T {
  if (isKind(node)) return node
  throw new Error(message)
}

function expressionOf(node: Node): Expression {
  return narrowNode(node, isExpressionKind, `Expected an expression, got ${node.type}`)
}

function statementOf(node: Node): Statement {
  return narrowNode(node, isStatementKind, `Expected a statement, got ${node.type}`)
}

interface SwitchCaseShape {
  readonly test: Expression | null
  readonly consequent: Statement[]
}

function isSwitchCase(node: Node): node is Node & SwitchCaseShape {
  return nodeType(node) === 'SwitchCase'
}

function switchCaseOf(node: Node): Node & SwitchCaseShape {
  return narrowNode(node, isSwitchCase, `Expected a switch case, got ${node.type}`)
}

export function throwPlacementError(
  error: Error,
  nodePath: TraversePath,
  placer: MutantPlacer,
  mutants: Mutant[],
  fileName: string,
  lineTable: readonly number[],
  basePath?: string,
): never {
  const message = `${placer.name} could not place mutants with type(s): "${
    placementListFormat.format(mutants.map((mutant) => mutant.mutatorName))
  }"`
  const errorMessage = `${
    placementLocation(nodePath.node, fileName, lineTable, basePath)
  } ${message}. Either remove this file from the list of files to be mutated, or exclude the mutator (using \`mutator.excludedMutations\`). Original error: ${error.stack}`
  throw new Error(errorMessage)
}

const fileNameWithin = (basePath: string | undefined, fileName: string): string => {
  if (basePath === undefined) {
    return fileName
  }
  return relativeTo(basePath, fileName)
}

function placementLocation(node: Node, fileName: string, lineTable: readonly number[], basePath?: string): string {
  const relativeFile = fileNameWithin(basePath, fileName)
  const position = Option.map(
    Option.fromNullishOr(spanOf(node)),
    (span) => positionFromLineTable(span.start, lineTable),
  )
  return Option.match(position, {
    onNone: () => `${relativeFile}:undefined:undefined`,
    onSome: (at) => `${relativeFile}:${at.line}:${at.column}`,
  })
}

type AnonymousFunctionOrClass = FunctionExpression | ClassExpression
const placementListFormat = new Intl.ListFormat('en')

const normalizeSeparators = (value: string): string => value.replace(/\\/g, '/')

const withTrailingSlash = (basePath: string): string => {
  const normalized = normalizeSeparators(basePath)
  if (normalized.endsWith('/')) {
    return normalized
  }
  return `${normalized}/`
}

const relativeTo = (basePath: string, fileName: string): string => {
  const prefix = withTrailingSlash(basePath)
  const normalizedFile = normalizeSeparators(fileName)
  if (!normalizedFile.startsWith(prefix)) {
    return fileName
  }
  return normalizedFile.slice(prefix.length)
}

function classOrFunctionExpressionNamedIfNeeded(path: TraversePath): Expression | undefined {
  return Match.value(path.node).pipe(
    Match.when(isAnonymousFunctionOrClass, (node) => nameFromParent(path, node)),
    Match.orElse(() => undefined),
  )
}

function nameFromParent(path: TraversePath, node: AnonymousFunctionOrClass): Expression | undefined {
  return Match.value(path.parentPath?.node).pipe(
    Match.when(isVariableDeclarator, (declarator) => adoptDeclaredName(node, declarator)),
    Match.when({ type: 'Property', key: { type: 'Identifier' } }, () => namedPropertyValue(path, node)),
    Match.orElse(() => undefined),
  )
}

/** A property value only survives by name when the declaration above it carries one. */
function namedPropertyValue(path: TraversePath, node: AnonymousFunctionOrClass): Expression | undefined {
  return Match.value(path.getStatementParent()?.node.type).pipe(
    Match.when('VariableDeclaration', () => node),
    Match.orElse(() => undefined),
  )
}

function adoptIdentifier(node: AnonymousFunctionOrClass, identifier: IdentifierReference): Expression {
  node.id = identifier
  return node
}

function isAnonymousFunctionOrClass(node: Node): node is AnonymousFunctionOrClass {
  return isFunctionOrClassExpression(node) && node.id == null
}

function isFunctionOrClassExpression(node: Node): node is AnonymousFunctionOrClass {
  return node.type === 'FunctionExpression' || node.type === 'ClassExpression'
}

function arrowFunctionExpressionNamedIfNeeded(path: TraversePath): Expression | undefined {
  return Match.value(path.node).pipe(
    Match.when({ type: 'ArrowFunctionExpression' }, (node) => arrowNamedByDeclarator(node, path.parentPath)),
    Match.orElse(() => undefined),
  )
}

/** An arrow bound to a named declaration is re-emitted as a named function. */
function arrowNamedByDeclarator(
  node: ArrowFunctionExpression,
  parentPath: TraversePath | null,
): Expression | undefined {
  return Option.match(declaratorIdentifier(parentPath), {
    onNone: () => undefined,
    onSome: (identifier) => namedArrowExpression(node, identifier),
  })
}

function namedArrowExpression(node: ArrowFunctionExpression, identifier: IdentifierReference): Expression {
  const declaration = variableDeclaration('const', [variableDeclarator(identifier, node)])
  return callExpression(
    arrowFunctionExpression([], blockStatement([declaration, returnStatement(identifier)])),
    [],
  )
}

function declaratorIdentifier(parentPath: TraversePath | null): Option.Option<IdentifierReference> {
  return Option.flatMap(Option.fromNullishOr(parentPath), (parent) =>
    Match.value(parent.node).pipe(
      Match.when(isVariableDeclarator, (declarator) => declaredName(declarator)),
      Match.orElse(() => Option.none<IdentifierReference>()),
    ))
}

function isVariableDeclarator(node: unknown): node is VariableDeclarator {
  return nodeType(node) === 'VariableDeclarator'
}

function adoptDeclaredName(node: AnonymousFunctionOrClass, declarator: VariableDeclarator): Expression | undefined {
  return Option.match(declaredName(declarator), {
    onNone: () => undefined,
    onSome: (identifier) => adoptIdentifier(node, identifier),
  })
}

function declaredName(declarator: VariableDeclarator): Option.Option<IdentifierReference> {
  return Match.value(declarator.id).pipe(
    Match.when(isIdentifierReference, (identifier) => Option.some(identifier)),
    Match.orElse(() => Option.none<IdentifierReference>()),
  )
}

function isIdentifierReference(node: unknown): node is IdentifierReference {
  return nodeType(node) === 'Identifier'
}

function nameIfAnonymous(path: TraversePath): Expression {
  return classOrFunctionExpressionNamedIfNeeded(path) ?? arrowNameOrNode(path)
}

function arrowNameOrNode(path: TraversePath): Expression {
  return arrowFunctionExpressionNamedIfNeeded(path) ?? expressionOf(path.node)
}

function isChainLink(node: Node | undefined): boolean {
  return [isMemberExpressionNode(node), isCallExpressionNode(node), isNonNullExpression(node)].some((holds) => holds)
}

function isMemberExpressionNode(node: Node | undefined): boolean {
  return nodeType(node) === 'MemberExpression'
}

function isCallExpressionNode(node: Node | undefined): boolean {
  return nodeType(node) === 'CallExpression'
}

function isNonNullExpression(node: Node | undefined): boolean {
  return nodeType(node) === 'TSNonNullExpression'
}

function isValidExpression(path: TraversePath): boolean {
  const parent = path.parentPath
  return parent === null || !isUnmutatableContext(path, parent)
}

function isUnmutatableContext(path: TraversePath, parent: TraversePath): boolean {
  return [
    isObjectPropertyKey(path, parent),
    isPartOfChain(path, parent),
    isTaggedTemplateTag(parent),
    isDeletedOperand(path, parent),
    isAssignedTarget(path, parent),
  ].some((invalid) => invalid)
}

function isObjectPropertyKey(path: TraversePath, parent: TraversePath): boolean {
  const parentNode = parent.node
  return parentNode.type === 'Property' && parentNode.key === path.node
}

function isTaggedTemplateTag(parent: TraversePath): boolean {
  return parent.node.type === 'TaggedTemplateExpression'
}

function isDeletedOperand(path: TraversePath, parent: TraversePath): boolean {
  const parentNode = parent.node
  return parentNode.type === 'UnaryExpression' && parentNode.operator === 'delete'
}

function isAssignedTarget(path: TraversePath, parent: TraversePath): boolean {
  const parentNode = parent.node
  return parentNode.type === 'AssignmentExpression' && parentNode.left === path.node
}

function isPartOfChain(path: TraversePath, parent: TraversePath): boolean {
  return isChainLink(path.node) && chainContinuesIn(path, parent)
}

function chainContinuesIn(path: TraversePath, parent: TraversePath): boolean {
  return [
    isMemberAccessParent(path, parent),
    isNonNullExpression(parent.node),
    isCalleeParent(path, parent),
  ].some((continues) => continues)
}

function isMemberAccessParent(path: TraversePath, parent: TraversePath): boolean {
  const parentNode = parent.node
  return parentNode.type === 'MemberExpression' && isNotACallOnTheNode(parentNode, path.node)
}

function isCalleeParent(path: TraversePath, parent: TraversePath): boolean {
  const parentNode = parent.node
  return parentNode.type === 'CallExpression' && parentNode.callee === path.node
}

function isNotACallOnTheNode(member: MemberExpression, node: Node): boolean {
  return !(member.computed && member.property === node)
}

export function unwrapParenthesizedExpression(node: Node): Node {
  return Option.getOrElse(innerExpression(node), () => node)
}

interface ParenthesizedWrapper {
  readonly expression?: Node | null
}

function innerExpression(node: Node): Option.Option<Node> {
  return Option.flatMap(
    Option.filter(Option.some<unknown>(node), isParenthesizedWrapper),
    (parenthesized) => Option.map(Option.fromNullishOr(parenthesized.expression), unwrapParenthesizedExpression),
  )
}

function isParenthesizedWrapper(value: unknown): value is ParenthesizedWrapper {
  return Predicate.hasProperty(value, 'type') && value['type'] === 'ParenthesizedExpression'
}

export const expressionMutantPlacer: MutantPlacer = {
  name: 'expressionMutantPlacer',
  canPlace(path) {
    return path.isExpression() && isValidExpression(path)
  },
  place(path, appliedMutants) {
    let expression = nameIfAnonymous(path)
    expression = mutationCoverageSequenceExpression(
      appliedMutants.keys(),
      expression,
    )
    for (const [mutant, appliedMutant] of appliedMutants) {
      expression = conditionalExpression(
        mutantTestExpression(mutant.id),
        nodeOfKind(
          mutant,
          unwrapParenthesizedExpression(appliedMutant),
          isExpressionKind,
          'an expression',
        ),
        expression,
      )
    }
    path.replaceWith(expression)
  },
}

export const statementMutantPlacer: MutantPlacer = {
  name: 'statementMutantPlacer',
  canPlace(path) {
    return path.isStatement()
  },
  place(path, appliedMutants) {
    const body = [expressionStatement(mutationCoverageSequenceExpression(appliedMutants.keys())), ...statementsOf(path)]
    const statement = [...appliedMutants].reduce(guardedStatement, blockStatement(body))
    path.replaceWith(wrappedStatement(path, statement))
  },
}

function statementsOf(path: TraversePath): readonly Statement[] {
  const node = path.node
  if (node.type === 'BlockStatement') {
    return node.body
  }
  return [statementOf(node)]
}

function guardedStatement(statement: Statement, entry: readonly [Mutant, Node]): Statement {
  return ifStatement(
    mutantTestExpression(entry[0].id),
    blockStatement([nodeOfKind(entry[0], entry[1], isStatementKind, 'a statement')]),
    statement,
  )
}

function wrappedStatement(path: TraversePath, statement: Statement): Statement {
  return Match.value(nodeType(path.node)).pipe(
    Match.when('BlockStatement', () => blockStatement([statement])),
    Match.orElse(() => statement),
  )
}

export const switchCaseMutantPlacer: MutantPlacer = {
  name: 'switchCaseMutantPlacer',
  canPlace(path) {
    return nodeType(path.node) === 'SwitchCase'
  },
  place(path, appliedMutants) {
    const currentCase = switchCaseOf(path.node)
    let consequence: Statement = blockStatement([
      expressionStatement(
        mutationCoverageSequenceExpression(appliedMutants.keys()),
      ),
      ...currentCase.consequent,
    ])
    for (const [mutant, appliedMutant] of appliedMutants) {
      const appliedCase = nodeOfKind(mutant, appliedMutant, isSwitchCase, 'a switch case')
      consequence = ifStatement(
        mutantTestExpression(mutant.id),
        blockStatement(appliedCase.consequent),
        consequence,
      )
    }
    path.replaceWith(switchCase(currentCase.test, [consequence]))
  },
}

export const allMutantPlacers: readonly MutantPlacer[] = Object.freeze([
  expressionMutantPlacer,
  statementMutantPlacer,
  switchCaseMutantPlacer,
])

function isCommentArray(value: unknown): value is readonly unknown[] {
  return Array.isArray(value)
}

const INSTRUMENTATION_HEADER_SOURCE = `// @ts-nocheck
var ${STRYKER_NAMESPACE_HELPER} = function(){
  var g = typeof globalThis === 'object' && globalThis && globalThis.Math === Math && globalThis || new Function("return this")();
  var ns = g.${ID.NAMESPACE} || (g.${ID.NAMESPACE} = {});
  if (ns.${ID.ACTIVE_MUTANT} === undefined && g.process && g.process.env && g.process.env.${ID.ACTIVE_MUTANT_ENV_VARIABLE}) {
    ns.${ID.ACTIVE_MUTANT} = g.process.env.${ID.ACTIVE_MUTANT_ENV_VARIABLE};
  }
  function retrieveNS(){
    return ns;
  }
  ${STRYKER_NAMESPACE_HELPER} = retrieveNS;
  return retrieveNS();
};
${STRYKER_NAMESPACE_HELPER}();

var ${COVER_MUTANT_HELPER} = function() {
  var ns = ${STRYKER_NAMESPACE_HELPER}();
  var cov = ns.${ID.MUTATION_COVERAGE_OBJECT} || (ns.${ID.MUTATION_COVERAGE_OBJECT} = { static: {}, perTest: {} });
  function cover() {
    var c = cov.static;
    if (ns.${ID.CURRENT_TEST_ID}) {
      c = cov.perTest[ns.${ID.CURRENT_TEST_ID}] = cov.perTest[ns.${ID.CURRENT_TEST_ID}] || {};
    }
    var a = arguments;
    for(var i=0; i < a.length; i++){
      c[a[i]] = (c[a[i]] || 0) + 1;
    }
  }
  ${COVER_MUTANT_HELPER} = cover;
  cover.apply(null, arguments);
};
var ${IS_MUTANT_ACTIVE_HELPER} = function(id) {
  var ns = ${STRYKER_NAMESPACE_HELPER}();
  function isActive(id) {
    if (ns.${ID.ACTIVE_MUTANT} === id) {
      if (ns.${ID.HIT_COUNT} !== void 0 && ++ns.${ID.HIT_COUNT} > ns.${ID.HIT_LIMIT}) {
        throw new Error('Stryker: Hit count limit reached (' + ns.${ID.HIT_COUNT} + ')');
      }
      return true;
    }
    return false;
  }
  ${IS_MUTANT_ACTIVE_HELPER} = isActive;
  return isActive(id);
}`

let instrumentationHeaderValue: readonly Statement[] | undefined

const instrumentationHeader: Effect.Effect<readonly Statement[], ParseFailed> = Effect.gen(function*() {
  if (instrumentationHeaderValue === undefined) {
    const parsed = yield* parseWithOxc(INSTRUMENTATION_HEADER_SOURCE, 'instrumenter-header.js', 'js')
    instrumentationHeaderValue = parsed.root.body
    deepFreeze(instrumentationHeaderValue)
  }
  return instrumentationHeaderValue
})

export const placeHeaderIfNeeded = (
  mutantCollector: MutantCollector,
  originFileName: string,
  options: MutatorOptions,
  root: Program,
): Effect.Effect<void, ParseFailed> =>
  Effect.gen(function*() {
    if (shouldPlaceHeader(mutantCollector, originFileName, options)) {
      yield* placeHeader(root)
    }
  })

export const placeHeader = (root: Program): Effect.Effect<void, ParseFailed> =>
  Effect.map(headerFor(root), (header) => {
    root.body.unshift(...header)
  })

function shouldPlaceHeader(
  mutantCollector: MutantCollector,
  originFileName: string,
  options: MutatorOptions,
): boolean {
  return hasPlacedMutants(mutantCollector, originFileName) && options.noHeader !== true
}

const headerFor = (root: Program): Effect.Effect<readonly Statement[], ParseFailed> =>
  Effect.map(instrumentationHeader, (header) =>
    Option.match(leadingCommentsOf(root), {
      onNone: () => header,
      onSome: (leadingComments) => [commentedHeader(leadingComments, header), ...header.slice(1)],
    }))

function leadingCommentsOf(root: Program): Option.Option<readonly unknown[]> {
  return Option.filter(Option.some<unknown>(leadingCommentsOn(root.body[0])), isCommentArray)
}

function commentedHeader(leadingComments: readonly unknown[], header: readonly Statement[]): Statement {
  const firstHeader = Option.getOrThrowWith(
    Option.fromNullishOr(header[0]),
    () => new Error('Instrumentation header is empty'),
  )
  const cloned = cloneNode(firstHeader)
  Object.assign(cloned, { leadingComments })
  return cloned
}

function deepFreeze(value: unknown): unknown {
  return Option.match(frozenContainer(value), {
    onNone: () => value,
    onSome: (frozen) => frozen,
  })
}

function frozenContainer(value: unknown): Option.Option<unknown> {
  return Option.map(Option.filter(Option.some(value), isObjectValue), (object) => {
    freezableChildren(object).forEach((child) => {
      deepFreeze(child)
    })
    return Object.freeze(object)
  })
}

function freezableChildren(value: Record<string, unknown>): readonly unknown[] {
  return [...mapEntries(value), ...setItems(value), ...Object.values(value)]
}

function mapEntries(value: object): readonly unknown[] {
  return Option.getOrElse(
    Option.map(Option.filter(Option.some(value), isMap), (map) => [...map.entries()].flat()),
    () => NO_CHILDREN,
  )
}

function setItems(value: object): readonly unknown[] {
  return Option.getOrElse(Option.map(Option.filter(Option.some(value), isSet), (set) => [...set]), () => NO_CHILDREN)
}

function isObjectValue(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object'
}

function isMap(value: object): value is Map<unknown, unknown> {
  return value instanceof Map
}

function isSet(value: object): value is Set<unknown> {
  return value instanceof Set
}

export const transform = (
  ast: Ast,
  mutantCollector: MutantCollector,
  transformerContext: Omit<TransformerContext, 'transform'>,
): Effect.Effect<readonly string[], ParseFailed> => {
  const context: TransformerContext = {
    ...transformerContext,
    transform,
  }
  switch (ast.format) {
    case 'html':
      return transformHtml(ast, mutantCollector, context)
    case 'js':
    case 'ts':
    case 'tsx':
      return transformScript(ast, mutantCollector, context)
    case 'svelte':
      return transformSvelte(ast, mutantCollector, context)
  }
}

export type AstTransformer<T extends AstFormat> = (
  ast: AstByFormat[T],
  mutantCollector: MutantCollector,
  context: TransformerContext,
) => Effect.Effect<readonly string[], ParseFailed>

export interface TransformerContext {
  transform: AstTransformer<AstFormat>
  options: TransformerOptions
  mutateDescription: MutateDescription
  readonly basePath?: string | undefined
}

export const transformHtml: AstTransformer<'html'> = (
  { root },
  mutantCollector,
  context,
) =>
  Effect.map(
    Effect.forEach(root.scripts, (script) => context.transform(script, mutantCollector, context)),
    (perScript) => perScript.flat(),
  )

const moduleScriptStart = '<script context="module">\n'
const moduleScript = `${moduleScriptStart}\n</script>\n`

export const transformSvelte: AstTransformer<'svelte'> = (
  svelte,
  mutantCollector,
  context,
) =>
  Effect.gen(function*() {
    const { root } = svelte
    const scripts = [root.moduleScript, ...root.additionalScripts].filter(Predicate.isNotNullish)
    const perScript = yield* Effect.forEach(scripts, (script) =>
      context.transform(script.ast, mutantCollector, {
        ...context,
        options: {
          ...context.options,
          noHeader: true,
        },
      }))
    const warnings: string[] = perScript.flat()
    yield* placeModuleHeaderIfNeeded(svelte, mutantCollector)
    return warnings
  })

const placeModuleHeaderIfNeeded = (
  svelte: AstByFormat['svelte'],
  mutantCollector: MutantCollector,
): Effect.Effect<void, ParseFailed> =>
  Effect.gen(function*() {
    if (hasPlacedMutants(mutantCollector, svelte.originFileName)) {
      yield* placeModuleHeader(svelte)
    }
  })

const placeModuleHeader = (svelte: AstByFormat['svelte']): Effect.Effect<void, ParseFailed> =>
  Effect.gen(function*() {
    const { root, originFileName } = svelte
    if (!root.moduleScript) {
      root.moduleScript = {
        ast: {
          format: 'js',
          root: emptyProgram(),
          comments: [],
          rawContent: '',
          originFileName,
        },
        range: {
          start: moduleScriptStart.length,
          end: moduleScriptStart.length,
        },
        isExpression: false,
      }
      svelte.rawContent = `${moduleScript}${svelte.rawContent}`
      svelte.root.additionalScripts.forEach((script) => {
        script.range.start += moduleScript.length
        script.range.end += moduleScript.length
      })
    }
    yield* placeHeader(root.moduleScript.ast.root)
  })

function emptyProgram(): Program {
  return { type: 'Program', sourceType: 'module', body: [], hashbang: null }
}

interface MutantsPlacement {
  appliedMutants: Map<Mutant, Node>
  placer: MutantPlacer
}

type PlacementMap = Map<Node, MutantsPlacement>

const emptyAppliedMutants = (): Map<Mutant, Node> => new Map()

function isMutateRangeList(value: MutateDescription): value is readonly SourceLocationInFile[] {
  return Array.isArray(value)
}

export const transformScript: AstTransformer<ScriptFormat> = (
  { root, originFileName, rawContent, offset, comments },
  mutantCollector,
  { options, mutateDescription, basePath },
  mutators?: typeof allMutators,
  mutantPlacers?: readonly MutantPlacer[],
) => {
  const placementMap: PlacementMap = new Map()
  return Effect.gen(function*() {
    const lineTable = buildLineTable(rawContent)

    attachComments(root, comments, lineTable)
    let directiveRule: Rule = rootRule
    const mutatorEntries = Object.entries(Option.getOrElse(Option.fromNullishOr(mutators), () => allMutators))
    const placers = Option.getOrElse(Option.fromNullishOr(mutantPlacers), () => allMutantPlacers)
    const allMutatorNames = mutatorEntries.map(([name]) => name.toLowerCase())

    const warnings: string[] = []

    traverse(root, {
      enter(path) {
        const result = processStrykerDirectives(directiveRule, path.node, allMutatorNames, originFileName)
        directiveRule = result.rule
        warnings.push(...result.warnings)
        visitNode(path)
      },
      exit(path) {
        const placement = placementMap.get(path.node)
        if (hasAppliedMutants(placement)) {
          applyPlacement(path, placement)
        }
      },
    })

    yield* placeHeaderIfNeeded(mutantCollector, originFileName, options, root)

    return warnings

    function visitNode(path: TraversePath): void {
      if (shouldSkip(path)) {
        path.skip()
        return
      }
      addToPlacementMapIfPossible(path)
      placeCollectedMutantsIfMutating(path)
    }
    function addToPlacementMapIfPossible(path: TraversePath): void {
      const placer = placers.find((candidate) => candidate.canPlace(path))
      if (placer !== undefined) {
        placementMap.set(path.node, { appliedMutants: emptyAppliedMutants(), placer })
      }
    }
    function hasAppliedMutants(placement: MutantsPlacement | undefined): placement is MutantsPlacement {
      return placement !== undefined && placement.appliedMutants.size > 0
    }
    function applyPlacement(path: TraversePath, placement: MutantsPlacement): void {
      try {
        placement.placer.place(path, placement.appliedMutants)
        path.skip()
      } catch (error) {
        throwPlacementError(
          toError(error),
          path,
          placement.placer,
          [...placement.appliedMutants.keys()],
          originFileName,
          lineTable,
          basePath,
        )
      }
    }
    function placeCollectedMutantsIfMutating(path: TraversePath): void {
      if (shouldMutate(path)) {
        placeCollectedMutants(path)
      }
    }
    function placeCollectedMutants(path: TraversePath): void {
      const mutantsToPlace = collectMutants(path)
      if (mutantsToPlace.length === 0) {
        return
      }
      const placementPath = requiredPlacementPath(path, mutantsToPlace)
      const placement = requiredPlacement(placementPath.node)
      mutantsToPlace.forEach((mutant) => {
        placement.appliedMutants.set(mutant, applyMutant(mutant, placementPath.node))
      })
    }
    function requiredPlacementPath(path: TraversePath, mutantsToPlace: readonly Mutant[]): TraversePath {
      return Option.getOrThrowWith(
        Option.fromNullishOr(path.find((ancestor) => placementMap.has(ancestor.node))),
        () => unplacedMutantsError(mutantsToPlace),
      )
    }
    function unplacedMutantsError(mutantsToPlace: readonly Mutant[]): Error {
      return new Error(
        `Mutants cannot be placed. This shouldn't happen! Unplaced mutants: ${JSON.stringify(mutantsToPlace, null, 2)}`,
      )
    }
    function requiredPlacement(node: Node): MutantsPlacement {
      return Option.getOrThrowWith(
        Option.fromNullishOr(placementMap.get(node)),
        () => new Error('Placement not found for node'),
      )
    }
    function shouldSkip(path: TraversePath): boolean {
      return [
        isTypeNode(path),
        isImportDeclaration(path),
        nodeType(path.node) === 'Decorator',
        mutateDescription === false,
        isOutsideMutateRanges(path),
      ].some((skip) => skip)
    }
    function mutateRanges(): Option.Option<readonly SourceLocationInFile[]> {
      return Option.filter(Option.some(mutateDescription), isMutateRangeList)
    }
    function isOutsideMutateRanges(path: TraversePath): boolean {
      return Option.exists(
        mutateRanges(),
        (ranges) => ranges.every((range) => !locationOverlaps(range, getNodeLocation(path.node))),
      )
    }
    function shouldMutate(path: TraversePath): boolean {
      return mutateDescription === true || isInsideMutateRanges(path)
    }
    function isInsideMutateRanges(path: TraversePath): boolean {
      return Option.exists(
        mutateRanges(),
        (ranges) => ranges.some((range) => locationIncluded(range, getNodeLocation(path.node))),
      )
    }
    function getNodeLocation(node: Node): SourceLocationInFile {
      const span = spanOf(node)
      if (span === undefined) {
        throw new Error('Node without a span')
      }
      return {
        start: positionFromLineTable(span.start, lineTable),
        end: positionFromLineTable(span.end, lineTable),
      }
    }
    function ignoreMessageFor(node: Node, ancestors: readonly Node[]): string | undefined {
      return ignorerReason(node, ancestors)
    }
    function ignorerReason(node: Node, ancestors: readonly Node[]): string | undefined {
      return options.ignorers.map((ignorer) => ignorer.shouldIgnore(node, ancestors)).find((reason) =>
        reason !== undefined
      )
    }
    function collectMutants(path: TraversePath): Mutant[] {
      return mutablesFor(path).map((mutable) =>
        collect(mutantCollector, originFileName, path.node, mutable, offset, lineTable)
      )
        .filter((mutant) => mutant.ignoreReason === undefined)
    }
    function mutablesFor(path: TraversePath): readonly Mutable[] {
      const ancestors = ancestorsOf(path)
      const context = toMutatorContext(ancestors)
      const line = getNodeLocation(path.node).start.line
      return mutatorEntries.flatMap(([mutatorName, mutate]) =>
        [...mutate(path.node, context)].map((replacement) =>
          mutableFor(path.node, ancestors, mutatorName, replacement, line)
        )
      )
    }
    function mutableFor(
      node: Node,
      ancestors: readonly Node[],
      mutatorName: string,
      replacement: Node,
      line: number,
    ): Mutable {
      const mutableEntry: Mutable = { replacement, mutatorName }
      const ignoreReason = ignoreReasonFor(node, ancestors, mutatorName, line)
      if (ignoreReason !== undefined) {
        mutableEntry.ignoreReason = ignoreReason
      }
      return mutableEntry
    }
    function ignoreReasonFor(
      node: Node,
      ancestors: readonly Node[],
      mutatorName: string,
      line: number,
    ): string | undefined {
      return directiveOrExclusion(mutatorName, line) ?? ignoreMessageFor(node, ancestors)
    }
    function directiveOrExclusion(mutatorName: string, line: number): string | undefined {
      return findIgnoreReason(directiveRule, mutatorName, line) ?? findExcludedMutatorIgnoreReason(mutatorName)
    }
    function findExcludedMutatorIgnoreReason(mutatorName: string): string | undefined {
      if (options.excludedMutations.includes(mutatorName)) {
        return `Ignored because of excluded mutation "${mutatorName}"`
      } else {
        return undefined
      }
    }
  })
}

function toMutatorContext(ancestors: readonly Node[]): MutatorContext {
  return {
    parent: ancestors[0],
    grandParent: ancestors[1],
    ancestors: [...ancestors],
  }
}

function toError(value: unknown): Error {
  if (value instanceof Error) {
    return value
  }
  return new Error('Unexpected error', { cause: value })
}
