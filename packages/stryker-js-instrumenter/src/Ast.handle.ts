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
import * as Boolean from 'effect/Boolean'
import { dual } from 'effect/Function'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Predicate from 'effect/Predicate'
import type { Pipeable } from 'effect/Pipeable'
import { Prototype } from 'effect/Pipeable'
import { walk, type WalkerCallbackContext, type WalkerThisContextEnter } from 'oxc-walker'
import type { SpannedComment } from './Ast.schema.js'
import type { LineTable } from './Location.schema.js'

export const TypeId = Symbol.for('~systemfsoftware/stryker-js-instrumenter/Ast')
export type TypeId = typeof TypeId

export interface AstHandle extends Pipeable {
  readonly [TypeId]: typeof TypeId
  readonly root: Program | Node
}

export const isAstHandle = (value: unknown): value is AstHandle => Predicate.hasProperty(value, TypeId)

export const make = (root: Program | Node): AstHandle => ({ [TypeId]: TypeId, root, ...Prototype })

const EXPRESSION_KINDS: Readonly<Record<string, true>> = {
  ArrayExpression: true,
  ArrowFunctionExpression: true,
  AwaitExpression: true,
  BinaryExpression: true,
  CallExpression: true,
  ChainExpression: true,
  ClassExpression: true,
  ConditionalExpression: true,
  FunctionExpression: true,
  Identifier: true,
  Import: true,
  ImportExpression: true,
  JSXElement: true,
  JSXFragment: true,
  Literal: true,
  LogicalExpression: true,
  MemberExpression: true,
  MetaProperty: true,
  NewExpression: true,
  ObjectExpression: true,
  PrivateIdentifier: true,
  SequenceExpression: true,
  Super: true,
  TaggedTemplateExpression: true,
  TemplateLiteral: true,
  ThisExpression: true,
  TSAsExpression: true,
  TSInstantiationExpression: true,
  TSNonNullExpression: true,
  TSSatisfiesExpression: true,
  TSTypeAssertion: true,
  UnaryExpression: true,
  UpdateExpression: true,
  YieldExpression: true,
}

const STATEMENT_KINDS: Readonly<Record<string, true>> = {
  BlockStatement: true,
  BreakStatement: true,
  ClassDeclaration: true,
  ContinueStatement: true,
  DebuggerStatement: true,
  DoWhileStatement: true,
  ExportAllDeclaration: true,
  ExportDefaultDeclaration: true,
  ExportNamedDeclaration: true,
  ExpressionStatement: true,
  ForInStatement: true,
  ForOfStatement: true,
  ForStatement: true,
  FunctionDeclaration: true,
  IfStatement: true,
  ImportDeclaration: true,
  LabeledStatement: true,
  ReturnStatement: true,
  SwitchStatement: true,
  ThrowStatement: true,
  TSExportAssignment: true,
  TSImportEqualsDeclaration: true,
  TSInterfaceDeclaration: true,
  TSModuleDeclaration: true,
  TSTypeAliasDeclaration: true,
  VariableDeclaration: true,
  WhileStatement: true,
  WithStatement: true,
}

export const spanOf = (node: Node): { start: number; end: number } | undefined =>
  Option.getOrUndefined(
    Option.map(Option.fromNullishOr(node.range), (range) => ({ start: range[0], end: range[1] })),
  )

export const nodeType = <A = unknown>(node: A): string | undefined =>
  Option.getOrUndefined(Option.map(Option.filter(Option.some(node), isAstNode), (ast) => ast.type))

export function isExpressionKind(node: Node | undefined | null): node is Expression {
  const type = nodeType(node)
  return type !== undefined && EXPRESSION_KINDS[type] === true
}

export function isStatementKind(node: Node | undefined | null): node is Statement {
  const type = nodeType(node)
  return type !== undefined && STATEMENT_KINDS[type] === true
}

type Loc = { start: number; end: number } | undefined

const mark = <T extends object>(node: T, loc: Loc): T =>
  Option.match(Option.fromNullishOr(loc), {
    onNone: () => node,
    onSome: (at) => Object.assign(node, { start: at.start, end: at.end }),
  })

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
  (params: ReadonlyArray<ParamPattern>, body: BlockStatement | Expression, loc?: Loc): Expression
  (body: BlockStatement | Expression, loc?: Loc): (params: ReadonlyArray<ParamPattern>) => Expression
} = dual(
  (args: IArguments): boolean => isDataFirstArity(args, 2),
  (params: ReadonlyArray<ParamPattern>, body: BlockStatement | Expression, loc?: Loc): Expression =>
    mark<Expression>(
      {
        type: 'ArrowFunctionExpression',
        id: null,
        generator: false,
        params: [...params],
        body,
        async: false,
        expression: !isStatementKind(body),
      },
      loc,
    ),
)

export const blockStatement: {
  (body: ReadonlyArray<Statement>, loc?: Loc): BlockStatement
  (loc?: Loc): (body: ReadonlyArray<Statement>) => BlockStatement
} = dual(
  (args: IArguments): boolean => Array.isArray(args[0]),
  (body: ReadonlyArray<Statement>, loc?: Loc): BlockStatement =>
    mark<BlockStatement>({ type: 'BlockStatement', body: [...body] }, loc),
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

export const cloneNode = <T extends Node>(node: T): T => structuredClone(node)

export interface AttachedComment extends SpannedComment {
  readonly loc?: { start: { line: number; column: number }; end: { line: number; column: number } }
}

export const attachComments: {
  (comments: ReadonlyArray<SpannedComment>, lineTable: LineTable): (self: AstHandle) => void
  (self: AstHandle, comments: ReadonlyArray<SpannedComment>, lineTable: LineTable): void
} = dual(
  (args: IArguments): boolean => args.length >= 3,
  (self: AstHandle, comments: ReadonlyArray<SpannedComment>, lineTable: LineTable): void =>
    Boolean.match(comments.length === 0, {
      onTrue: () => undefined,
      onFalse: () => {
        const nodes = collectNodes(self.root).filter((entry) => entry.node !== self.root)
        nodes.sort((a, b) => a.start - b.start)
        const groups = groupComments(nodes, comments)
        assignComments(groups.leading, lineTable, 'leadingComments')
        assignComments(groups.trailing, lineTable, 'trailingComments')
      },
    }),
)

interface CommentGroups {
  readonly leading: Map<Node, SpannedComment[]>
  readonly trailing: Map<Node, SpannedComment[]>
}

interface CommentHost {
  readonly field: keyof CommentGroups
  readonly node: Node
}

const groupComments = (
  nodes: ReadonlyArray<NodeEntry>,
  comments: ReadonlyArray<SpannedComment>,
): CommentGroups => {
  const groups: CommentGroups = { leading: new Map(), trailing: new Map() }
  comments.forEach((comment) => hostComment(nodes, comment, groups))
  return groups
}

const hostComment = (nodes: ReadonlyArray<NodeEntry>, comment: SpannedComment, groups: CommentGroups): void =>
  Option.match(Option.fromNullishOr(commentHost(nodes, comment)), {
    onNone: () => undefined,
    onSome: (host) => pushComment(groups[host.field], host.node, comment),
  })

const commentHost = (
  nodes: ReadonlyArray<NodeEntry>,
  comment: SpannedComment,
): CommentHost | undefined => {
  const hosts: ReadonlyArray<{ readonly field: keyof CommentGroups; readonly node: Node | undefined }> = [
    { field: 'leading', node: followingNode(nodes, comment) },
    { field: 'trailing', node: precedingStatement(nodes, comment) },
  ]
  return hosts.find((candidate): candidate is CommentHost => candidate.node !== undefined)
}

const followingNode = (nodes: ReadonlyArray<NodeEntry>, comment: SpannedComment): Node | undefined =>
  Option.getOrUndefined(Option.map(Option.fromNullishOr(nodes.find((candidate) => candidate.start >= comment.end)), (entry) => entry.node))

const precedingStatement = (nodes: ReadonlyArray<NodeEntry>, comment: SpannedComment): Node | undefined =>
  Option.getOrUndefined(
    Option.map(
      Option.fromNullishOr(nodes.findLast((candidate) => candidate.end <= comment.start && isStatementKind(candidate.node))),
      (entry) => entry.node,
    ),
  )

const assignComments = (
  map: Map<Node, SpannedComment[]>,
  lineTable: LineTable,
  field: 'leadingComments' | 'trailingComments',
): void =>
  map.forEach((list, node) =>
    Object.assign(node, {
      [field]: list.map((comment) => ({
        ...comment,
        loc: {
          start: lineTable.positionAt(comment.start),
          end: lineTable.positionAt(comment.end),
        },
      })),
    }),
  )

const pushComment = (map: Map<Node, SpannedComment[]>, node: Node, comment: SpannedComment): void =>
  Option.match(Option.fromNullishOr(map.get(node)), {
    onNone: () => map.set(node, [comment]),
    onSome: (list) => list.push(comment),
  })

const isProgram = (node: Program | Node): node is Program => nodeType(node) === 'Program'
const walkableNode = (root: Program | Node): Oxc.Program | Oxc.Node =>
  Boolean.match(isProgram(root), {
    onTrue: () => root,
    onFalse: () => absurdMember(root),
  })
const absurdMember = (root: Program | Node): Oxc.Node => root as Oxc.Node
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

const collectNodes = (root: Program | Node): NodeEntry[] => {
  const out: NodeEntry[] = []
  walker(root, {
    enter(node) {
      appendEntry(node, out)
    },
  })
  return out
}

const appendEntry = (node: Oxc.Node, out: NodeEntry[]): void =>
  Option.match(Option.fromNullishOr(spanOf(node)), {
    onNone: () => undefined,
    onSome: (span) => out.push({ node, start: span.start, end: span.end }),
  })

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

export interface TraversePath {
  readonly node: Node
  readonly parentPath: TraversePath | null
  skip(): void
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

const COMMENT_KEYS: Readonly<Record<string, true>> = { leadingComments: true, trailingComments: true }

const isCommentKey = <A = unknown>(key: A): boolean => typeof key === 'string' && COMMENT_KEYS[key] === true

const walkTraverse = (root: Program | Node, stack: TraversePath[], visitors: TraverseVisitors): void => {
  walk(walkableNode(root), {
    enter(node, _parent, context) {
      readPath(stack, node, this, context, visitors)
    },
    leave(_node, _parent, context) {
      closePath(stack, context, visitors)
    },
  })
}

export const traverse: {
  (visitors: TraverseVisitors): (self: AstHandle) => void
  (self: AstHandle, visitors: TraverseVisitors): void
} = dual(
  2,
  (self: AstHandle, visitors: TraverseVisitors): void => walkTraverse(self.root, [], visitors),
)

const readPath = (
  stack: TraversePath[],
  node: Oxc.Node,
  controls: WalkerThisContextEnter,
  context: WalkerCallbackContext,
  visitors: TraverseVisitors,
): void =>
  Boolean.match(isCommentKey(context.key), {
    onTrue: () => undefined,
    onFalse: () => {
      const path = createPath(node, parentOf(stack), controls, context)
      stack.push(path)
      notify(visitors.enter, path)
    },
  })

const closePath = (stack: TraversePath[], context: WalkerCallbackContext, visitors: TraverseVisitors): void =>
  Boolean.match(isCommentKey(context.key), {
    onTrue: () => undefined,
    onFalse: () => notify(visitors.exit, stack.pop()),
  })

const parentOf = (stack: ReadonlyArray<TraversePath>): TraversePath | null => Option.getOrNull(Arr.last(stack))

const notify = (visitor: TraverseVisitor | undefined, path: TraversePath | undefined): void =>
  Option.match(Option.all({ visitor: Option.fromNullishOr(visitor), path: Option.fromNullishOr(path) }), {
    onNone: () => undefined,
    onSome: ({ visitor: visit, path: target }) => visit(target),
  })

const keyOf = (context: WalkerCallbackContext): string | undefined =>
  Option.getOrUndefined(Option.filter(Option.some(context.key), Predicate.isString))

const createPath = (
  node: Oxc.Node,
  parentPath: TraversePath | null,
  controls: WalkerThisContextEnter,
  context: WalkerCallbackContext,
): TraversePath => {
  const key = keyOf(context)
  const path: TraversePath = {
    node,
    parentPath,
    skip() {
      controls.skip()
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

const nearest = (
  from: TraversePath | null,
  predicate: (path: TraversePath) => boolean,
): TraversePath | undefined =>
  Option.getOrUndefined(Option.map(Option.fromNullishOr(from), (start) => takeOrAscend(start, predicate)))

const takeOrAscend = (
  path: TraversePath,
  predicate: (path: TraversePath) => boolean,
): TraversePath =>
  Boolean.match(predicate(path), {
    onTrue: () => path,
    onFalse: () => nearest(path.parentPath, predicate) ?? path,
  })

const replaceInSlot = (
  parentPath: TraversePath | null,
  key: string | undefined,
  index: number | null,
  replacement: Node,
): void =>
  Option.match(Option.fromNullishOr(parentPath), {
    onNone: () => undefined,
    onSome: (parent) => writeInto(parent.node, key, index, replacement),
  })

const writeInto = <A = unknown, B = unknown>(parent: A, key: B, index: number | null, replacement: Node): void =>
  Option.match(Option.filter(Option.some(parent), isAstNode), {
    onNone: () => undefined,
    onSome: (ast) => writeAtKey(ast, key, index, replacement),
  })

const writeAtKey = <A = unknown>(
  parent: Record<string, AstNodeRecord[string]>,
  key: A,
  index: number | null,
  replacement: Node,
): void =>
  Option.match(Option.filter(Option.some(key), Predicate.isString), {
    onNone: () => undefined,
    onSome: (name) => writeAtSlot(parent, name, index, replacement),
  })

const writeAtSlot = (
  parent: Record<string, AstNodeRecord[string]>,
  key: string,
  index: number | null,
  replacement: Node,
): void =>
  Match.value(index).pipe(
    Match.when(Match.null, () => overwrite(parent, key, replacement)),
    Match.orElse((position) => writeElement(parent[key], position, replacement)),
  )

const overwrite = (parent: Record<string, AstNodeRecord[string]>, key: string, replacement: Node): void => {
  parent[key] = replacement
}

const writeElement = <A = unknown>(container: A, index: number, replacement: Node): void =>
  Option.match(Option.filter(Option.some(container), isNodeList), {
    onNone: () => undefined,
    onSome: (list) => {
      list[index] = replacement
    },
  })
