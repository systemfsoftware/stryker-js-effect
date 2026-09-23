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
import { dual } from 'effect/Function'
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
  'MemberExpression',
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

export function nodeType<A = unknown>(node: A): string | undefined {
  if (!isAstNode(node)) return undefined
  return node.type
}

export function isExpressionKind(node: Node | undefined | null): node is Expression {
  const type = nodeType(node)
  return type !== undefined && EXPRESSION_KINDS.has(type)
}

export function isStatementKind(node: Node | undefined | null): node is Statement {
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

type Span = { start: number; end: number }

const isObjectArg = (value: unknown): value is object => typeof value === 'object' && value !== null

export const isNodeArg = (value: unknown): value is { type: string } => isObjectArg(value) && 'type' in value

const hasRangeKeys = (value: object): boolean => 'start' in value && 'end' in value

const isSpanObject = (value: object): boolean => !isNodeArg(value) && hasRangeKeys(value)

const isLocArg = (value: unknown): value is Span => isObjectArg(value) && isSpanObject(value)

const atArityWithoutLoc = (args: IArguments, arity: number): boolean =>
  args.length === arity && !isLocArg(args[arity - 1])

const isDataFirstArity = (args: IArguments, arity: number): boolean =>
  args.length > arity || atArityWithoutLoc(args, arity)

const isNodeOrNullArg = (value: unknown): value is Expression | null => value === null || isNodeArg(value)

const isElementsArg = (value: unknown): value is ReadonlyArray<Expression | null> | undefined =>
  Array.isArray(value) || value === undefined

export const identifier: {
  (name: string, loc?: Loc): IdentifierReference
  (loc?: Loc): (name: string) => IdentifierReference
} = dual(
  (args: IArguments): boolean => typeof args[0] === 'string',
  (name: string, loc?: Loc): IdentifierReference => mark({ type: 'Identifier', name }, loc),
)

export const stringLiteral: {
  (value: string, loc?: Loc): Expression
  (loc?: Loc): (value: string) => Expression
} = dual(
  (args: IArguments): boolean => typeof args[0] === 'string',
  (value: string, loc?: Loc): Expression => mark({ type: 'Literal', value, raw: null }, loc),
)

export const booleanLiteral: {
  (value: boolean, loc?: Loc): Expression
  (loc?: Loc): (value: boolean) => Expression
} = dual(
  (args: IArguments): boolean => typeof args[0] === 'boolean',
  (value: boolean, loc?: Loc): Expression => mark({ type: 'Literal', value, raw: null }, loc),
)

export const regExpLiteral: {
  (pattern: string, flags: string, loc?: Loc): Expression
  (flags: string, loc?: Loc): (pattern: string) => Expression
} = dual(
  (args: IArguments): boolean => isDataFirstArity(args, 2),
  (pattern: string, flags: string, loc?: Loc): Expression =>
    mark({ type: 'Literal', value: null, raw: null, regex: { pattern, flags } }, loc),
)

export const arrayExpression: {
  (elements: ReadonlyArray<Expression | null> | undefined, loc?: Loc): Expression
  (loc?: Loc): (elements: ReadonlyArray<Expression | null> | undefined) => Expression
} = dual(
  (args: IArguments): boolean => args.length >= 1 && isElementsArg(args[0]),
  (elements: ReadonlyArray<Expression | null> | undefined = [], loc?: Loc): Expression =>
    mark<Expression>({ type: 'ArrayExpression', elements: elements.filter(Predicate.isNotNullish) }, loc),
)

export const callExpression: {
  (callee: Expression, args?: ReadonlyArray<Expression>, optional?: boolean, loc?: Loc): Expression
  (args?: ReadonlyArray<Expression>, optional?: boolean, loc?: Loc): (callee: Expression) => Expression
} = dual(
  (args: IArguments): boolean => args.length >= 1 && isNodeArg(args[0]),
  (callee: Expression, args: ReadonlyArray<Expression> = [], optional?: boolean, loc?: Loc): Expression =>
    mark<Expression>({ type: 'CallExpression', callee, arguments: [...args], optional: optional === true }, loc),
)

export const newExpression: {
  (callee: Expression, args?: ReadonlyArray<Expression>, loc?: Loc): Expression
  (args?: ReadonlyArray<Expression>, loc?: Loc): (callee: Expression) => Expression
} = dual(
  (args: IArguments): boolean => args.length >= 1 && isNodeArg(args[0]),
  (callee: Expression, args: ReadonlyArray<Expression> = [], loc?: Loc): Expression =>
    mark<Expression>({ type: 'NewExpression', callee, arguments: [...args] }, loc),
)

export const memberExpression: {
  (object: Expression, property: IdentifierName, optional: boolean, loc?: Loc): Expression
  (property: IdentifierName, optional: boolean, loc?: Loc): (object: Expression) => Expression
} = dual(
  (args: IArguments): boolean => isDataFirstArity(args, 3),
  (object: Expression, property: IdentifierName, optional: boolean, loc?: Loc): Expression =>
    mark<Expression>(
      { type: 'MemberExpression', object, property, computed: false, optional },
      loc,
    ),
)

export const arrowFunctionExpression: {
  (params: ReadonlyArray<ParamPattern>, body: Expression | Statement, loc?: Loc): Expression
  (body: Expression | Statement, loc?: Loc): (params: ReadonlyArray<ParamPattern>) => Expression
} = dual(
  (args: IArguments): boolean => isDataFirstArity(args, 2),
  (params: ReadonlyArray<ParamPattern>, body: Expression | Statement, loc?: Loc): Expression => {
    const fnBody = arrowFunctionBody(body)
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
  },
)

function arrowFunctionBody(body: Expression | Statement): BlockStatement | Expression {
  if (isArrowBody(body)) return body
  throw new Error(`Invalid arrow function body: ${body.type}`)
}

function isArrowBody(body: Expression | Statement): body is BlockStatement | Expression {
  return isBlockStatementNode(body) || isExpressionKind(body)
}

function isBlockStatementNode(node: Expression | Statement): node is BlockStatement {
  return nodeType(node) === 'BlockStatement'
}

export const blockStatement: {
  (body: ReadonlyArray<Statement>, loc?: Loc): Statement
  (loc?: Loc): (body: ReadonlyArray<Statement>) => Statement
} = dual(
  (args: IArguments): boolean => Array.isArray(args[0]),
  (body: ReadonlyArray<Statement>, loc?: Loc): Statement =>
    mark<Statement>({ type: 'BlockStatement', body: [...body] }, loc),
)

export const expressionStatement: {
  (expression: Expression, loc?: Loc): Statement
  (loc?: Loc): (expression: Expression) => Statement
} = dual(
  (args: IArguments): boolean => args.length >= 1 && isNodeArg(args[0]),
  (expression: Expression, loc?: Loc): Statement => mark<Statement>({ type: 'ExpressionStatement', expression }, loc),
)

export const ifStatement: {
  (test: Expression, consequent: Statement, alternate?: Statement | null, loc?: Loc): Statement
  (consequent: Statement, alternate?: Statement | null, loc?: Loc): (test: Expression) => Statement
} = dual(
  (args: IArguments): boolean => isDataFirstArity(args, 2),
  (test: Expression, consequent: Statement, alternate?: Statement | null, loc?: Loc): Statement =>
    mark<Statement>({ type: 'IfStatement', test, consequent, alternate: alternate ?? null }, loc),
)

export const variableDeclarator: {
  (id: BindingPattern | IdentifierReference, init: Expression | null, loc?: Loc): VariableDeclarator
  (init: Expression | null, loc?: Loc): (id: BindingPattern | IdentifierReference) => VariableDeclarator
} = dual(
  (args: IArguments): boolean => isDataFirstArity(args, 2),
  (id: BindingPattern | IdentifierReference, init: Expression | null, loc?: Loc): VariableDeclarator =>
    mark<VariableDeclarator>({ type: 'VariableDeclarator', id, init }, loc),
)

export const variableDeclaration: {
  (kind: 'const' | 'let' | 'var', declarations: ReadonlyArray<VariableDeclarator>, loc?: Loc): Statement
  (declarations: ReadonlyArray<VariableDeclarator>, loc?: Loc): (kind: 'const' | 'let' | 'var') => Statement
} = dual(
  (args: IArguments): boolean => isDataFirstArity(args, 2),
  (kind: 'const' | 'let' | 'var', declarations: ReadonlyArray<VariableDeclarator>, loc?: Loc): Statement =>
    mark<Statement>({ type: 'VariableDeclaration', kind, declarations: [...declarations] }, loc),
)

export const returnStatement: {
  (argument: Expression | null, loc?: Loc): Statement
  (loc?: Loc): (argument: Expression | null) => Statement
} = dual(
  (args: IArguments): boolean => args.length >= 1 && isNodeOrNullArg(args[0]),
  (argument: Expression | null, loc?: Loc): Statement => mark<Statement>({ type: 'ReturnStatement', argument }, loc),
)

export const sequenceExpression: {
  (expressions: ReadonlyArray<Expression>, loc?: Loc): Expression
  (loc?: Loc): (expressions: ReadonlyArray<Expression>) => Expression
} = dual(
  (args: IArguments): boolean => Array.isArray(args[0]),
  (expressions: ReadonlyArray<Expression>, loc?: Loc): Expression =>
    mark<Expression>({ type: 'SequenceExpression', expressions: [...expressions] }, loc),
)

export const conditionalExpression: {
  (test: Expression, consequent: Expression, alternate: Expression, loc?: Loc): Expression
  (consequent: Expression, alternate: Expression, loc?: Loc): (test: Expression) => Expression
} = dual(
  (args: IArguments): boolean => isDataFirstArity(args, 3),
  (test: Expression, consequent: Expression, alternate: Expression, loc?: Loc): Expression =>
    mark<Expression>({ type: 'ConditionalExpression', test, consequent, alternate }, loc),
)

export const unaryExpression: {
  (
    operator: Extract<Oxc.UnaryOperator, '+' | '-' | '!' | '~' | 'typeof' | 'void' | 'delete'>,
    argument: Expression,
    loc?: Loc,
  ): Expression
  (argument: Expression, loc?: Loc): (
    operator: Extract<Oxc.UnaryOperator, '+' | '-' | '!' | '~' | 'typeof' | 'void' | 'delete'>,
  ) => Expression
} = dual(
  (args: IArguments): boolean => isDataFirstArity(args, 2),
  (
    operator: Extract<Oxc.UnaryOperator, '+' | '-' | '!' | '~' | 'typeof' | 'void' | 'delete'>,
    argument: Expression,
    loc?: Loc,
  ): Expression => mark<Expression>({ type: 'UnaryExpression', operator, argument, prefix: true }, loc),
)

export const updateExpression: {
  (operator: '++' | '--', argument: SimpleAssignmentTarget, prefix: boolean, loc?: Loc): Expression
  (argument: SimpleAssignmentTarget, prefix: boolean, loc?: Loc): (operator: '++' | '--') => Expression
} = dual(
  (args: IArguments): boolean => isDataFirstArity(args, 3),
  (operator: '++' | '--', argument: SimpleAssignmentTarget, prefix: boolean, loc?: Loc): Expression =>
    mark<Expression>({ type: 'UpdateExpression', operator, argument, prefix }, loc),
)

export const templateElement: {
  (raw: string, loc?: Loc): TemplateElement
  (loc?: Loc): (raw: string) => TemplateElement
} = dual(
  (args: IArguments): boolean => typeof args[0] === 'string',
  (raw: string, loc?: Loc): TemplateElement =>
    mark<TemplateElement>({ type: 'TemplateElement', value: { raw, cooked: raw }, tail: true }, loc),
)

export const templateLiteral: {
  (quasis: ReadonlyArray<TemplateElement>, expressions: ReadonlyArray<Expression>, loc?: Loc): Expression
  (expressions: ReadonlyArray<Expression>, loc?: Loc): (quasis: ReadonlyArray<TemplateElement>) => Expression
} = dual(
  (args: IArguments): boolean => isDataFirstArity(args, 2),
  (quasis: ReadonlyArray<TemplateElement>, expressions: ReadonlyArray<Expression>, loc?: Loc): Expression =>
    mark<Expression>({ type: 'TemplateLiteral', quasis: [...quasis], expressions: [...expressions] }, loc),
)

export const switchCase: {
  (test: Expression | null, consequent: ReadonlyArray<Statement>, loc?: Loc): SwitchCase
  (consequent: ReadonlyArray<Statement>, loc?: Loc): (test: Expression | null) => SwitchCase
} = dual(
  (args: IArguments): boolean => isDataFirstArity(args, 2),
  (test: Expression | null, consequent: ReadonlyArray<Statement>, loc?: Loc): SwitchCase =>
    mark<SwitchCase>({ type: 'SwitchCase', test, consequent: [...consequent] }, loc),
)

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

export const attachComments: {
  (root: Node, comments: ReadonlyArray<Comment>, lineTable: readonly number[]): void
  (comments: ReadonlyArray<Comment>, lineTable: readonly number[]): (root: Node) => void
} = dual(
  (args: IArguments): boolean => args.length >= 3,
  (root: Node, comments: ReadonlyArray<Comment>, lineTable: readonly number[]): void => {
    if (comments.length === 0) return
    const nodes = collectNodes(root).filter((entry) => entry.node !== root)
    nodes.sort((a, b) => a.start - b.start)
    const groups = groupComments(nodes, comments)
    assignComments(groups.leading, lineTable, 'leadingComments')
    assignComments(groups.trailing, lineTable, 'trailingComments')
  },
)

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

const isNodeList = (value: unknown): value is Array<Node> => Array.isArray(value)

const walkableNode = (node: Node): Oxc.Node => {
  if (isAstNode(node)) return node
  throw new Error('Expected an AST node to walk')
}

const walker: Walker = (root, visitors) => {
  const ancestors: Oxc.Node[] = []
  walk(walkableNode(root), {
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
export interface AstNodeRecord {
  readonly [k: string]:
    | Node
    | readonly Node[]
    | string
    | number
    | boolean
    | null
    | undefined
    | AstNodeRecord
    | readonly AstNodeRecord[]
}

export function isAstNode(value: unknown): value is Oxc.Node & AstNodeRecord {
  return Predicate.isObject(value) && typeof value['type'] === 'string'
}

export function buildLineTable(content: string): readonly number[] {
  return computeLineStarts(content)
}

export const positionFromLineTable: {
  (offset: number, lineTable: readonly number[]): { line: number; column: number }
  (lineTable: readonly number[]): (offset: number) => { line: number; column: number }
} = dual(
  (args: IArguments): boolean => args.length >= 2,
  (offset: number, lineTable: readonly number[]): { line: number; column: number } => {
    const zeroBased = positionFromOffset(lineTable, offset)
    return { line: zeroBased.line + 1, column: zeroBased.column + 1 }
  },
)

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

function isCommentKey<A = unknown>(key: A): boolean {
  return typeof key === 'string' && COMMENT_KEYS.has(key)
}

function walkTraverse(root: Program | Node, stack: TraversePath[], visitors: TraverseVisitors): void {
  walk(walkableNode(root), {
    enter(node, _parent, context) {
      readPath(stack, node, this, context, visitors)
    },
    leave(_node, _parent, context) {
      closePath(stack, context, visitors)
    },
  })
}
const toTraverseError = <A = unknown>(error: A): Error =>
  error instanceof Error ? error : new Error('Traversal failed', { cause: error })

const handleTraverseError = <A = unknown>(error: A): void => {
  const err = toTraverseError(error)
  if (!S.is(TraversalStopped)(err)) throw err
}

export const traverse: {
  (root: Program | Node, visitors: TraverseVisitors): void
  (visitors: TraverseVisitors): (root: Program | Node) => void
} = dual(
  (args: IArguments): boolean => args.length >= 2,
  (root: Program | Node, visitors: TraverseVisitors): void => {
    const stack: TraversePath[] = []
    try {
      walkTraverse(root, stack, visitors)
    } catch (error: unknown) {
      handleTraverseError(error)
    }
  },
)

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

const keyOf = (context: WalkerCallbackContext): string | undefined => {
  if (typeof context.key === 'string') {
    return context.key
  }
  return undefined
}

function createPath(
  node: Oxc.Node,
  parentPath: TraversePath | null,
  controls: WalkerThisContextEnter,
  context: WalkerCallbackContext,
): TraversePath {
  const key = keyOf(context)
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

function writeInto<A = unknown, B = unknown>(parent: A, key: B, index: number | null, replacement: Node): void {
  if (!isAstNode(parent)) return
  writeAtKey(parent, key, index, replacement)
}

function writeAtKey<A = unknown>(
  parent: Record<string, AstNodeRecord[string]>,
  key: A,
  index: number | null,
  replacement: Node,
): void {
  if (Predicate.isString(key)) {
    writeAtSlot(parent, key, index, replacement)
  }
}

function writeAtSlot(
  parent: Record<string, AstNodeRecord[string]>,
  key: string,
  index: number | null,
  replacement: Node,
): void {
  Match.value(index).pipe(
    Match.when(Match.null, () => overwrite(parent, key, replacement)),
    Match.orElse((position) => writeElement(parent[key], position, replacement)),
  )
}

const overwrite = (parent: Record<string, AstNodeRecord[string]>, key: string, replacement: Node): void => {
  parent[key] = replacement
}

const writeElement = <A = unknown>(container: A, index: number, replacement: Node): void => {
  if (isNodeList(container)) container[index] = replacement
}
