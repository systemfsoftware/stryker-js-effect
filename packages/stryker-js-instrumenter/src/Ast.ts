// oxlint-disable typescript/no-unsafe-type-assertion typescript/no-unnecessary-type-assertion
import type * as Oxc from '@oxc-project/types'
import type {
  BindingPattern,
  BlockStatement,
  Expression,
  IdentifierName,
  IdentifierReference,
  Node,
  ParamPattern,
  Program,
  SimpleAssignmentTarget,
  Statement,
  SwitchCase,
  TemplateElement,
  VariableDeclarator,
  Walker,
} from '@systemfsoftware/stryker-ignorer-interface'
import * as Arr from 'effect/Array'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Predicate from 'effect/Predicate'
import * as S from 'effect/Schema'
import { walk, type WalkerCallbackContext, type WalkerThisContextEnter } from 'oxc-walker'

export type * from '@systemfsoftware/stryker-ignorer-interface'

import { computeLineStarts, positionFromOffset } from './Syntax.js'
import { TraversalStopped } from './Traversal.schema.js'

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

export function identifier(name: string, loc?: Loc): IdentifierReference {
  return mark({ type: 'Identifier', name }, loc)
}

export function stringLiteral(value: string, loc?: Loc): Expression {
  return mark({ type: 'Literal', value, raw: null }, loc)
}

export function booleanLiteral(value: boolean, loc?: Loc): Expression {
  return mark({ type: 'Literal', value, raw: null }, loc)
}

export function regExpLiteral(pattern: string, flags: string, loc?: Loc): Expression {
  return mark({ type: 'Literal', value: null, raw: null, regex: { pattern, flags } }, loc)
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
  property: IdentifierName,
  optional: boolean,
  loc?: Loc,
): Expression {
  return mark<Expression>(
    { type: 'MemberExpression', object, property, computed: false, optional },
    loc,
  )
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
  params: ReadonlyArray<ParamPattern>,
  body: Expression | Statement,
  loc?: Loc,
): Expression {
  const fnBody = body as BlockStatement | Expression
  return mark<Expression>(
    {
      type: 'ArrowFunctionExpression',
      id: null,
      generator: false,
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

export function variableDeclarator(
  id: BindingPattern | IdentifierReference,
  init: Expression | null,
  loc?: Loc,
): VariableDeclarator {
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

export function updateExpression(
  operator: '++' | '--',
  argument: SimpleAssignmentTarget,
  prefix: boolean,
  loc?: Loc,
): Expression {
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

const walker: Walker = (root, visitors) => {
  const ancestors: Oxc.Node[] = []
  walk(root as Oxc.Node, {
    enter(node) {
      visitors.enter?.(node, [...ancestors])
      ancestors.push(node)
    },
    leave(node) {
      ancestors.pop()
      visitors.leave?.(node, [...ancestors])
    },
  })
}

function collectNodes(root: Node): NodeEntry[] {
  const out: NodeEntry[] = []
  walker(root, {
    enter(node) {
      appendEntry(node, out)
    },
  })
  return out
}

function appendEntry(node: Node, out: NodeEntry[]): void {
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
  skip(): void
  stop(): void
  find(predicate: (path: TraversePath) => boolean): TraversePath | undefined
  getStatementParent(): TraversePath | undefined
  replaceWith(node: Node): void
  isExpression(): boolean
  isStatement(): boolean
}

export interface TraverseVisitors {
  enter?: TraverseVisitor
  exit?: TraverseVisitor
}

type TraverseVisitor = (path: TraversePath) => void

const COMMENT_KEYS: ReadonlySet<string> = new Set(['leadingComments', 'trailingComments'])

function isCommentKey(key: unknown): boolean {
  return typeof key === 'string' && COMMENT_KEYS.has(key)
}

export function traverse(root: Program | Node, visitors: TraverseVisitors): void {
  const stack: TraversePath[] = []
  try {
    walk(root as Oxc.Node, {
      enter(node, _parent, context) {
        readPath(stack, node, this, context, visitors)
      },
      leave(_node, _parent, context) {
        closePath(stack, context, visitors)
      },
    })
  } catch (error) {
    rethrowUnlessStopped(error)
  }
}

const rethrowUnlessStopped = (error: unknown): void => {
  if (!S.is(TraversalStopped)(error)) throw error
}

const readPath = (
  stack: TraversePath[],
  node: Oxc.Node,
  controls: WalkerThisContextEnter,
  context: WalkerCallbackContext,
  visitors: TraverseVisitors,
): void => {
  if (isCommentKey(context.key)) return
  const path = createPath(node, parentOf(stack), controls, context)
  stack.push(path)
  notify(visitors.enter, path)
}

const closePath = (stack: TraversePath[], context: WalkerCallbackContext, visitors: TraverseVisitors): void => {
  if (isCommentKey(context.key)) return
  notify(visitors.exit, stack.pop())
}

const parentOf = (stack: ReadonlyArray<TraversePath>): TraversePath | null => Option.getOrNull(Arr.last(stack))

function notify(visitor: TraverseVisitor | undefined, path: TraversePath | undefined): void {
  if (visitor === undefined) return
  relay(visitor, path)
}

const relay = (visitor: TraverseVisitor, path: TraversePath | undefined): void => {
  if (path !== undefined) visitor(path)
}

function createPath(
  node: Oxc.Node,
  parentPath: TraversePath | null,
  controls: WalkerThisContextEnter,
  context: WalkerCallbackContext,
): TraversePath {
  const key = typeof context.key === 'string' ? context.key : undefined
  const path: TraversePath = {
    node,
    parentPath,
    skip() {
      controls.skip()
    },
    stop() {
      throw TraversalStopped.make({})
    },
    find(predicate) {
      return nearest(path, predicate)
    },
    getStatementParent() {
      return nearest(parentPath, (ancestor) => isStatementKind(ancestor.node))
    },
    replaceWith(replacement) {
      replaceInSlot(parentPath, key, context.index, replacement)
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

function replaceInSlot(
  parentPath: TraversePath | null,
  key: string | undefined,
  index: number | null,
  replacement: Node,
): void {
  if (parentPath === null) return
  writeInto(parentPath.node, key, index, replacement)
}

function writeInto(parent: unknown, key: unknown, index: number | null, replacement: Node): void {
  if (!isAstNode(parent)) return
  writeAtKey(parent, key, index, replacement)
}

function writeAtKey(parent: Record<string, unknown>, key: unknown, index: number | null, replacement: Node): void {
  Match.value(key).pipe(
    Match.when(Predicate.isString, (slot) => writeAtSlot(parent, slot, index, replacement)),
    Match.orElse(() => undefined),
  )
}

function writeAtSlot(parent: Record<string, unknown>, key: string, index: number | null, replacement: Node): void {
  Match.value(index).pipe(
    Match.when(Match.null, () => overwrite(parent, key, replacement)),
    Match.orElse((position) => writeElement(parent[key], position, replacement)),
  )
}

const overwrite = (parent: Record<string, unknown>, key: string, replacement: Node): void => {
  parent[key] = replacement
}

const writeElement = (container: unknown, index: number, replacement: Node): void => {
  if (isNodeList(container)) container[index] = replacement
}
