// oxlint-disable typescript/no-unsafe-type-assertion typescript/no-unnecessary-type-assertion
import type * as Oxc from '@oxc-project/types'
import * as Predicate from 'effect/Predicate'

import { computeLineStarts, positionFromOffset } from './Syntax.js'

type BuiltFrom<T, K extends keyof T = never> = Omit<T, K | 'start' | 'end' | 'range'> & Partial<Oxc.Span>

export interface BaseNode {
  type: string
  start?: number
  end?: number
}

export interface Identifier extends Partial<Oxc.Span> {
  type: 'Identifier'
  name: string
}

type RawOptional<T> = Omit<T, 'raw'> & { raw?: string | null }
export type StringLiteral = RawOptional<BuiltFrom<Oxc.StringLiteral>>
export type NumericLiteral = RawOptional<BuiltFrom<Oxc.NumericLiteral>>
export type BooleanLiteral = RawOptional<BuiltFrom<Oxc.BooleanLiteral>>
export type BigIntLiteral = RawOptional<BuiltFrom<Oxc.BigIntLiteral>>
export type RegExpLiteral = RawOptional<BuiltFrom<Oxc.RegExpLiteral>>
export type NullLiteral = BuiltFrom<Oxc.NullLiteral>
export type Literal = StringLiteral | NumericLiteral | BooleanLiteral | NullLiteral | BigIntLiteral | RegExpLiteral

export interface ArrayExpression extends BuiltFrom<Oxc.ArrayExpression, 'elements'> {
  elements: Array<Expression | SpreadElement | null>
}
export type ObjectExpression = BuiltFrom<Oxc.ObjectExpression>
export type SpreadElement = Oxc.SpreadElement
export type Argument = Expression | SpreadElement

export interface CallExpression extends BuiltFrom<Oxc.CallExpression, 'callee' | 'arguments'> {
  callee: Expression
  arguments: Array<Argument>
}

export interface NewExpression extends BuiltFrom<Oxc.NewExpression, 'callee' | 'arguments'> {
  callee: Expression
  arguments: Array<Argument>
}

export interface MemberExpression extends Partial<Oxc.Span> {
  type: 'MemberExpression'
  object: Expression
  property: Expression | Oxc.PrivateIdentifier
  computed: boolean
  optional: boolean
}

export interface ArrowFunctionExpression
  extends BuiltFrom<Oxc.ArrowFunctionExpression, 'params' | 'body' | 'id' | 'generator'>
{
  params: Array<Identifier | Oxc.ParamPattern>
  body: Expression | BlockStatement
  id?: null
  generator?: false
}

export interface BlockStatement extends BuiltFrom<Oxc.BlockStatement, 'body'> {
  body: Array<Statement>
}

export interface ExpressionStatement extends BuiltFrom<Oxc.ExpressionStatement, 'expression'> {
  expression: Expression
}

export interface IfStatement extends BuiltFrom<Oxc.IfStatement, 'test' | 'consequent' | 'alternate'> {
  test: Expression
  consequent: Statement
  alternate: Statement | null
}

export interface VariableDeclarator extends BuiltFrom<Oxc.VariableDeclarator, 'id' | 'init'> {
  id: Identifier | Oxc.BindingPattern
  init: Expression | null
}

export interface VariableDeclaration extends BuiltFrom<Oxc.VariableDeclaration, 'declarations'> {
  declarations: Array<VariableDeclarator>
}

export interface ReturnStatement extends BuiltFrom<Oxc.ReturnStatement, 'argument'> {
  argument: Expression | null
}

export interface SequenceExpression extends BuiltFrom<Oxc.SequenceExpression, 'expressions'> {
  expressions: Array<Expression>
}

export interface ConditionalExpression
  extends BuiltFrom<Oxc.ConditionalExpression, 'test' | 'consequent' | 'alternate'>
{
  test: Expression
  consequent: Expression
  alternate: Expression
}

export interface UnaryExpression extends BuiltFrom<Oxc.UnaryExpression, 'argument'> {
  argument: Expression
}

export interface UpdateExpression extends BuiltFrom<Oxc.UpdateExpression, 'argument'> {
  argument: Expression
}

export interface ForStatement extends BuiltFrom<Oxc.ForStatement, 'test'> {
  test: Expression | null
}

export interface SwitchCase extends BuiltFrom<Oxc.SwitchCase, 'test' | 'consequent'> {
  test: Expression | null
  consequent: Array<Statement>
}

export type TemplateElement = BuiltFrom<Oxc.TemplateElement>

export interface TemplateLiteral extends BuiltFrom<Oxc.TemplateLiteral, 'quasis' | 'expressions'> {
  quasis: Array<TemplateElement>
  expressions: Array<Expression>
}

export interface Function extends BuiltFrom<Oxc.Function, 'id'> {
  id: Identifier | null
}

export interface Class extends BuiltFrom<Oxc.Class, 'id'> {
  id: Identifier | null
}

export type ClassExpression = Class & { type: 'ClassExpression' }

export type FunctionExpression = Function & { type: 'FunctionExpression' }

export interface Program extends BuiltFrom<Oxc.Program, 'body' | 'hashbang'> {
  body: Array<Oxc.Directive | Statement>
  hashbang?: Oxc.Hashbang | null
}

type BuiltExpression =
  | ArrayExpression
  | ArrowFunctionExpression
  | CallExpression
  | Class
  | ConditionalExpression
  | Function
  | Identifier
  | Literal
  | MemberExpression
  | NewExpression
  | ObjectExpression
  | SequenceExpression
  | TemplateLiteral
  | UnaryExpression
  | UpdateExpression

type BuiltStatement =
  | BlockStatement
  | Class
  | ExpressionStatement
  | ForStatement
  | Function
  | IfStatement
  | ReturnStatement
  | VariableDeclaration

type BuiltNode =
  | BuiltExpression
  | BuiltStatement
  | Program
  | SwitchCase
  | TemplateElement
  | VariableDeclarator

export type Expression = Oxc.Expression | BuiltExpression
export type Statement = Oxc.Statement | BuiltStatement
export type Node = Oxc.Node | BuiltNode

const EXPRESSION_KINDS: ReadonlySet<string> = new Set([
  'ArrayExpression',
  'ArrowFunctionExpression',
  'AwaitExpression',
  'BinaryExpression',
  'CallExpression',
  'ChainExpression',
  'ClassExpression',
  'ConditionalExpression',
  'FunctionExpression',
  'Identifier',
  'Import',
  'ImportExpression',
  'JSXElement',
  'JSXFragment',
  'Literal',
  'LogicalExpression',
  'MetaProperty',
  'NewExpression',
  'ObjectExpression',
  'PrivateIdentifier',
  'SequenceExpression',
  'Super',
  'TaggedTemplateExpression',
  'TemplateLiteral',
  'ThisExpression',
  'TSAsExpression',
  'TSInstantiationExpression',
  'TSNonNullExpression',
  'TSSatisfiesExpression',
  'TSTypeAssertion',
  'UnaryExpression',
  'UpdateExpression',
  'YieldExpression',
])

const STATEMENT_KINDS: ReadonlySet<string> = new Set([
  'BlockStatement',
  'BreakStatement',
  'ClassDeclaration',
  'ContinueStatement',
  'DebuggerStatement',
  'DoWhileStatement',
  'ExportAllDeclaration',
  'ExportDefaultDeclaration',
  'ExportNamedDeclaration',
  'ExpressionStatement',
  'ForInStatement',
  'ForOfStatement',
  'ForStatement',
  'FunctionDeclaration',
  'IfStatement',
  'ImportDeclaration',
  'LabeledStatement',
  'ReturnStatement',
  'SwitchStatement',
  'ThrowStatement',
  'TSExportAssignment',
  'TSImportEqualsDeclaration',
  'TSInterfaceDeclaration',
  'TSModuleDeclaration',
  'TSTypeAliasDeclaration',
  'VariableDeclaration',
  'WhileStatement',
  'WithStatement',
])

export function spanOf(node: Node): { start: number; end: number } | undefined {
  const range = node.range
  if (range === undefined) return undefined
  return { start: range[0], end: range[1] }
}

export function nodeType(node: unknown): string | undefined {
  if (!isAstNode(node)) return undefined
  return node.type
}

export function isExpressionKind(node: Node | undefined | null): boolean {
  const type = nodeType(node)
  return type !== undefined && EXPRESSION_KINDS.has(type)
}

export function isStatementKind(node: Node | undefined | null): boolean {
  const type = nodeType(node)
  return type !== undefined && STATEMENT_KINDS.has(type)
}

type Loc = { start: number; end: number } | undefined

function mark<T extends object>(node: T, loc: Loc): T {
  if (loc !== undefined) {
    return Object.assign(node, { start: loc.start, end: loc.end })
  }
  return node
}

export function identifier(name: string, loc?: Loc): Identifier {
  return mark({ type: 'Identifier', name }, loc)
}

export function stringLiteral(value: string, loc?: Loc): Expression {
  return mark({ type: 'Literal', value }, loc)
}

export function booleanLiteral(value: boolean, loc?: Loc): Expression {
  return mark({ type: 'Literal', value }, loc)
}

export function regExpLiteral(pattern: string, flags: string, loc?: Loc): Expression {
  return mark({ type: 'Literal', value: null, regex: { pattern, flags } }, loc)
}

export function arrayExpression(elements: ReadonlyArray<Expression | null> = [], loc?: Loc): Expression {
  return mark<Expression>({ type: 'ArrayExpression', elements: elements.filter(Predicate.isNotNullish) }, loc)
}

export function callExpression(
  callee: Expression,
  args: ReadonlyArray<Expression> = [],
  optional?: boolean,
  loc?: Loc,
): Expression {
  return mark<Expression>({ type: 'CallExpression', callee, arguments: [...args], optional: optional === true }, loc)
}

export function newExpression(callee: Expression, args: ReadonlyArray<Expression> = [], loc?: Loc): Expression {
  return mark<Expression>({ type: 'NewExpression', callee, arguments: [...args] }, loc)
}

export function memberExpression(
  object: Expression,
  property: Expression,
  computed: boolean,
  optional: boolean,
  loc?: Loc,
): Expression {
  return mark<Expression>({ type: 'MemberExpression', object, property, computed, optional }, loc)
}

export function optionalMemberExpression(
  object: Expression,
  property: Expression,
  computed: boolean,
  optional: boolean,
  loc?: Loc,
): Expression {
  return mark<Expression>({ type: 'MemberExpression', object, property, computed, optional }, loc)
}

export function optionalCallExpression(
  callee: Expression,
  args: ReadonlyArray<Expression>,
  optional: boolean,
  loc?: Loc,
): Expression {
  return mark<Expression>({ type: 'CallExpression', callee, arguments: [...args], optional }, loc)
}

export function arrowFunctionExpression(
  params: ReadonlyArray<Identifier>,
  body: Expression | Statement,
  loc?: Loc,
): Expression {
  const fnBody = body as BlockStatement | Expression
  return mark<Expression>(
    {
      type: 'ArrowFunctionExpression',
      params: [...params],
      body: fnBody,
      async: false,
      expression: fnBody.type !== 'BlockStatement',
    },
    loc,
  )
}

export function blockStatement(body: ReadonlyArray<Statement>, loc?: Loc): Statement {
  return mark<Statement>({ type: 'BlockStatement', body: [...body] }, loc)
}

export function expressionStatement(expression: Expression, loc?: Loc): Statement {
  return mark<Statement>({ type: 'ExpressionStatement', expression }, loc)
}

export function ifStatement(
  test: Expression,
  consequent: Statement,
  alternate?: Statement | null,
  loc?: Loc,
): Statement {
  return mark<Statement>({ type: 'IfStatement', test, consequent, alternate: alternate ?? null }, loc)
}

export function variableDeclarator(id: Identifier, init: Expression | null, loc?: Loc): VariableDeclarator {
  return mark<VariableDeclarator>({ type: 'VariableDeclarator', id, init }, loc)
}

export function variableDeclaration(
  kind: 'const' | 'let' | 'var',
  declarations: ReadonlyArray<VariableDeclarator>,
  loc?: Loc,
): Statement {
  return mark<Statement>({ type: 'VariableDeclaration', kind, declarations: [...declarations] }, loc)
}

export function returnStatement(argument: Expression | null, loc?: Loc): Statement {
  return mark<Statement>({ type: 'ReturnStatement', argument }, loc)
}

export function sequenceExpression(expressions: ReadonlyArray<Expression>, loc?: Loc): Expression {
  return mark<Expression>({ type: 'SequenceExpression', expressions: [...expressions] }, loc)
}

export function conditionalExpression(
  test: Expression,
  consequent: Expression,
  alternate: Expression,
  loc?: Loc,
): Expression {
  return mark<Expression>({ type: 'ConditionalExpression', test, consequent, alternate }, loc)
}

export function unaryExpression(
  operator: Extract<Oxc.UnaryOperator, '+' | '-' | '!' | '~' | 'typeof' | 'void' | 'delete'>,
  argument: Expression,
  loc?: Loc,
): Expression {
  return mark<Expression>({ type: 'UnaryExpression', operator, argument, prefix: true }, loc)
}

export function updateExpression(operator: '++' | '--', argument: Expression, prefix: boolean, loc?: Loc): Expression {
  return mark<Expression>({ type: 'UpdateExpression', operator, argument, prefix }, loc)
}

export function templateElement(raw: string, loc?: Loc): TemplateElement {
  return mark<TemplateElement>({ type: 'TemplateElement', value: { raw, cooked: raw }, tail: true }, loc)
}

export function templateLiteral(
  quasis: ReadonlyArray<TemplateElement>,
  expressions: ReadonlyArray<Expression>,
  loc?: Loc,
): Expression {
  return mark<Expression>({ type: 'TemplateLiteral', quasis: [...quasis], expressions: [...expressions] }, loc)
}

export function switchCase(test: Expression | null, consequent: ReadonlyArray<Statement>, loc?: Loc): SwitchCase {
  return mark<SwitchCase>({ type: 'SwitchCase', test, consequent: [...consequent] }, loc)
}

export function cloneNode<T extends Node>(node: T): T {
  return structuredClone(node)
}

export interface Comment {
  readonly type: 'Line' | 'Block'
  readonly value: string
  readonly start: number
  readonly end: number
}

export interface AttachedComment extends Comment {
  readonly loc?: { start: { line: number; column: number }; end: { line: number; column: number } }
}

export function attachComments(
  root: Node,
  comments: ReadonlyArray<Comment>,
  lineTable: readonly number[],
): void {
  if (comments.length === 0) return
  const nodes = collectNodes(root).filter((entry) => entry.node !== root)
  nodes.sort((a, b) => a.start - b.start)
  const groups = groupComments(nodes, comments)
  assignComments(groups.leading, lineTable, 'leadingComments')
  assignComments(groups.trailing, lineTable, 'trailingComments')
}

interface CommentGroups {
  readonly leading: Map<Node, Comment[]>
  readonly trailing: Map<Node, Comment[]>
}

interface CommentHost {
  readonly field: keyof CommentGroups
  readonly node: Node
}

function groupComments(nodes: ReadonlyArray<NodeEntry>, comments: ReadonlyArray<Comment>): CommentGroups {
  const groups: CommentGroups = { leading: new Map(), trailing: new Map() }
  for (const comment of comments) hostComment(nodes, comment, groups)
  return groups
}

function hostComment(nodes: ReadonlyArray<NodeEntry>, comment: Comment, groups: CommentGroups): void {
  const hosts: ReadonlyArray<{ readonly field: keyof CommentGroups; readonly node: Node | undefined }> = [
    { field: 'leading', node: followingNode(nodes, comment) },
    { field: 'trailing', node: precedingStatement(nodes, comment) },
  ]
  const host = hosts.find((candidate): candidate is CommentHost => candidate.node !== undefined)
  if (host !== undefined) pushComment(groups[host.field], host.node, comment)
}

function followingNode(nodes: ReadonlyArray<NodeEntry>, comment: Comment): Node | undefined {
  const entry = nodes.find((candidate) => candidate.start >= comment.end)
  if (entry === undefined) return undefined
  return entry.node
}

function precedingStatement(nodes: ReadonlyArray<NodeEntry>, comment: Comment): Node | undefined {
  const entry = nodes.findLast((candidate) => candidate.end <= comment.start && isStatementKind(candidate.node))
  if (entry === undefined) return undefined
  return entry.node
}

function assignComments(
  map: Map<Node, Comment[]>,
  lineTable: readonly number[],
  field: 'leadingComments' | 'trailingComments',
): void {
  for (const [node, list] of map) {
    const located = list.map((comment) => ({
      ...comment,
      loc: {
        start: positionFromLineTable(comment.start, lineTable),
        end: positionFromLineTable(comment.end, lineTable),
      },
    }))
    Object.assign(node, { [field]: located })
  }
}

function pushComment(map: Map<Node, Comment[]>, node: Node, comment: Comment): void {
  const list = map.get(node)
  if (list === undefined) map.set(node, [comment])
  else list.push(comment)
}

interface NodeEntry {
  readonly node: Node
  readonly start: number
  readonly end: number
}

const isNodeList = (value: unknown): value is Array<unknown> => Array.isArray(value)

function collectNodes(node: unknown): NodeEntry[] {
  const out: NodeEntry[] = []
  collect(node, out)
  return out
}

function collect(node: unknown, out: NodeEntry[]): void {
  if (isNodeList(node)) return collectList(node, out)
  collectAstNode(node, out)
}

function collectList(items: ReadonlyArray<unknown>, out: NodeEntry[]): void {
  for (const item of items) collect(item, out)
}

function collectAstNode(value: unknown, out: NodeEntry[]): void {
  if (!isAstNode(value)) return
  appendEntry(value, out)
  collectChildren(value, out)
}

function collectChildren(node: Node & Record<string, unknown>, out: NodeEntry[]): void {
  for (const key of Object.keys(node)) collectChild(node, key, out)
}

function collectChild(node: Node & Record<string, unknown>, key: string, out: NodeEntry[]): void {
  if (SKIP_KEYS.has(key)) return
  collect(node[key], out)
}

function appendEntry(node: Node & Record<string, unknown>, out: NodeEntry[]): void {
  const span = spanOf(node)
  if (span === undefined) return
  out.push({ node, start: span.start, end: span.end })
}

export function isAstNode(value: unknown): value is Node & Record<string, unknown> {
  return Predicate.isObject(value) && typeof value['type'] === 'string'
}

export function buildLineTable(content: string): readonly number[] {
  return computeLineStarts(content)
}

export function positionFromLineTable(offset: number, lineTable: readonly number[]): { line: number; column: number } {
  const zeroBased = positionFromOffset(lineTable, offset)
  return { line: zeroBased.line + 1, column: zeroBased.column + 1 }
}

export interface TraversePath {
  readonly node: Node
  readonly parentPath: TraversePath | null
  readonly parent: Node | undefined
  readonly key: string
  readonly listKey: string | undefined
  skip(): void
  stop(): void
  find(predicate: (path: TraversePath) => boolean): TraversePath | undefined
  getStatementParent(): TraversePath | undefined
  replaceWith(node: Node): void
  is(kind: string): boolean
  isExpression(): boolean
  isStatement(): boolean
}

export interface TraverseVisitors {
  enter?: TraverseVisitor
  exit?: TraverseVisitor
}

type TraverseVisitor = (path: TraversePath) => void

interface WalkContext {
  readonly skipped: Set<Node>
  stopped: boolean
}

const SKIP_KEYS: ReadonlySet<string> = new Set([
  'type',
  'start',
  'end',
  'range',
  'loc',
  'leadingComments',
  'trailingComments',
])

export function traverse(root: Program | Node, visitors: TraverseVisitors): void {
  const context: WalkContext = { skipped: new Set(), stopped: false }
  visit(root, null, 'root', undefined, visitors, context)
}

function visit(
  node: unknown,
  parentPath: TraversePath | null,
  key: string,
  listKey: string | undefined,
  visitors: TraverseVisitors,
  context: WalkContext,
): void {
  if (context.stopped) return
  visitAstNode(node, parentPath, key, listKey, visitors, context)
}

function visitAstNode(
  node: unknown,
  parentPath: TraversePath | null,
  key: string,
  listKey: string | undefined,
  visitors: TraverseVisitors,
  context: WalkContext,
): void {
  if (!isVisitable(node, context)) return
  const path = createPath(node, parentPath, key, listKey, context)
  notify(visitors.enter, path)
  visitEnteredNode(node, path, visitors, context)
}

function isVisitable(node: unknown, context: WalkContext): node is Node & Record<string, unknown> {
  return isAstNode(node) && !context.skipped.has(node)
}

function visitEnteredNode(
  node: Node & Record<string, unknown>,
  path: TraversePath,
  visitors: TraverseVisitors,
  context: WalkContext,
): void {
  if (context.skipped.has(node)) return
  visitChildren(node, path, visitors, context)
  notifyExit(visitors.exit, path, context)
}

function notifyExit(visitor: TraverseVisitor | undefined, path: TraversePath, context: WalkContext): void {
  if (context.stopped) return
  notify(visitor, path)
}

function notify(visitor: TraverseVisitor | undefined, path: TraversePath): void {
  if (visitor === undefined) return
  visitor(path)
}

function visitChildren(
  node: Node & Record<string, unknown>,
  path: TraversePath,
  visitors: TraverseVisitors,
  context: WalkContext,
): void {
  Object.keys(node).every((key) => keepVisitingKey(node, path, key, visitors, context))
}

function keepVisitingKey(
  node: Node & Record<string, unknown>,
  path: TraversePath,
  key: string,
  visitors: TraverseVisitors,
  context: WalkContext,
): boolean {
  if (SKIP_KEYS.has(key)) return true
  return keepVisitingChild(node[key], path, key, visitors, context)
}

function keepVisitingChild(
  child: unknown,
  path: TraversePath,
  key: string,
  visitors: TraverseVisitors,
  context: WalkContext,
): boolean {
  if (isNodeList(child)) return keepVisitingList(child, path, key, visitors, context)
  return keepVisitingValue(child, path, key, undefined, visitors, context)
}

function keepVisitingList(
  items: ReadonlyArray<unknown>,
  path: TraversePath,
  key: string,
  visitors: TraverseVisitors,
  context: WalkContext,
): boolean {
  return items.every((item, index) => keepVisitingValue(item, path, key, String(index), visitors, context))
}

function keepVisitingValue(
  value: unknown,
  path: TraversePath,
  key: string,
  listKey: string | undefined,
  visitors: TraverseVisitors,
  context: WalkContext,
): boolean {
  visit(value, path, key, listKey, visitors, context)
  return !context.stopped
}

function createPath(
  node: Node,
  parentPath: TraversePath | null,
  key: string,
  listKey: string | undefined,
  context: WalkContext,
): TraversePath {
  const path: TraversePath = {
    node,
    parentPath,
    parent: parentPath?.node,
    key,
    listKey,
    skip() {
      context.skipped.add(node)
    },
    stop() {
      context.stopped = true
    },
    find(predicate) {
      return nearest(path, predicate)
    },
    getStatementParent() {
      return nearest(parentPath, (ancestor) => isStatementKind(ancestor.node))
    },
    replaceWith(replacement) {
      replaceInParent(parentPath, key, listKey, replacement)
    },
    is(kind) {
      return node.type === kind
    },
    isExpression() {
      return isExpressionKind(node)
    },
    isStatement() {
      return isStatementKind(node)
    },
  }
  return path
}

function nearest(
  from: TraversePath | null,
  predicate: (path: TraversePath) => boolean,
): TraversePath | undefined {
  if (from === null) return undefined
  return takeOrAscend(from, predicate)
}

function takeOrAscend(
  path: TraversePath,
  predicate: (path: TraversePath) => boolean,
): TraversePath | undefined {
  if (predicate(path)) return path
  return nearest(path.parentPath, predicate)
}

function replaceInParent(
  parentPath: TraversePath | null,
  key: string,
  listKey: string | undefined,
  replacement: Node,
): void {
  if (parentPath === null) return
  replaceChild(parentPath.node, key, listKey, replacement)
}

function replaceChild(parent: Node, key: string, listKey: string | undefined, replacement: Node): void {
  if (!isAstNode(parent)) return
  assignChild(parent, key, listKey, replacement)
}

function assignChild(
  parent: Node & Record<string, unknown>,
  key: string,
  listKey: string | undefined,
  replacement: Node,
): void {
  if (listKey === undefined) {
    parent[key] = replacement
    return
  }
  assignIndexed(parent, key, listKey, replacement)
}

function assignIndexed(
  parent: Record<string, unknown>,
  key: string,
  listKey: string,
  replacement: Node,
): void {
  const index = Number(listKey)
  const container = parent[key]
  if (isIndexedList(container, index)) container[index] = replacement
}

function isIndexedList(container: unknown, index: number): container is Array<unknown> {
  return isNodeList(container) && Number.isInteger(index)
}
