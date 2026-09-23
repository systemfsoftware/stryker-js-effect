import * as Arr from 'effect/Array'
import * as Boolean from 'effect/Boolean'
import { dual } from 'effect/Function'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import { isNodeArg } from '../Ast.handle.js'
import type {
  AccessorProperty,
  ArrayExpression,
  ArrowFunctionExpression,
  AssignmentExpression,
  AssignmentPattern,
  BindingIdentifier,
  BindingPattern,
  BlockStatement,
  CallExpression,
  CatchClause,
  Class,
  ClassBody,
  ConditionalExpression,
  Decorator,
  DoWhileStatement,
  ExportAllDeclaration,
  ExportDefaultDeclaration,
  ExportNamedDeclaration,
  Expression,
  ExpressionStatement,
  ForInStatement,
  ForOfStatement,
  ForStatement,
  Function as FunctionNode,
  IfStatement,
  ImportAttribute,
  ImportDeclaration,
  ImportExpression,
  JSDocNonNullableType,
  JSDocNullableType,
  JSXAttribute,
  JSXElement,
  JSXFragment,
  JSXMemberExpression,
  JSXOpeningElement,
  LabeledStatement,
  LabelIdentifier,
  LogicalExpression,
  MemberExpression,
  MetaProperty,
  MethodDefinition,
  NewExpression,
  Node,
  ObjectExpression,
  ParamPattern,
  Program,
  PropertyDefinition,
  ReturnStatement,
  SequenceExpression,
  Statement,
  StaticBlock,
  StringLiteral,
  SwitchCase,
  SwitchStatement,
  TaggedTemplateExpression,
  TemplateElement,
  TemplateLiteral,
  TryStatement,
  TSAsExpression,
  TSCallSignatureDeclaration,
  TSConstructSignatureDeclaration,
  TSEnumDeclaration,
  TSImportEqualsDeclaration,
  TSImportType,
  TSIndexSignature,
  TSInstantiationExpression,
  TSInterfaceBody,
  TSInterfaceDeclaration,
  TSLiteralType,
  TSMappedType,
  TSMethodSignature,
  TSNamedTupleMember,
  TSPropertySignature,
  TSSatisfiesExpression,
  TSTemplateLiteralType,
  TSTupleType,
  TSType,
  TSTypeAliasDeclaration,
  TSTypeAnnotation,
  TSTypeAssertion,
  TSTypeParameterDeclaration,
  TSTypeParameterInstantiation,
  TSTypePredicate,
  TSTypeQuery,
  TSTypeReference,
  UnaryExpression,
  UpdateExpression,
  VariableDeclaration,
  VariableDeclarator,
  WhileStatement,
  WithStatement,
  YieldExpression,
} from '@systemfsoftware/stryker-ignorer-interface'

export interface Comment {
  readonly type: 'Line' | 'Block'
  readonly value: string
  readonly start: number
  readonly end: number
}

export interface Hashbang {
  readonly type: 'Hashbang'
  readonly value: string
  readonly start: number
}

export interface PrintOptions {
  readonly comments?: readonly Comment[]
  readonly hashbang?: Hashbang | null
}

export interface PrintProgramOptions extends PrintOptions {}

export const printProgram: {
  (program: Program, opts?: PrintProgramOptions): string
  (opts?: PrintProgramOptions): (program: Program) => string
} = dual(
  (args: IArguments): boolean => args.length >= 1 && isNodeArg(args[0]),
  (program: Program, opts: PrintProgramOptions = {}): string => programText(opts, program),
)

export const printNode: {
  (node: Node, opts?: PrintOptions): string
  (opts?: PrintOptions): (node: Node) => string
} = dual(
  (args: IArguments): boolean => args.length >= 1 && isNodeArg(args[0]),
  (node: Node): string => dispatchNode({ indentLevel: 0 }, node, PREC.Sequence),
)

interface PrintContext {
  readonly indentLevel: number
}

const PREC = {
  Sequence: 0,
  Assignment: 1,
  Conditional: 2,
  NullishCoalescing: 3,
  LogicalOR: 4,
  LogicalAND: 5,
  BitwiseOR: 6,
  BitwiseXOR: 7,
  BitwiseAND: 8,
  Equality: 9,
  Relational: 10,
  Shift: 11,
  Additive: 12,
  Multiplicative: 13,
  Exponential: 14,
  Unary: 15,
  Update: 16,
  Call: 17,
  Member: 18,
  Primary: 19,
}

const BINARY_PRECEDENCE: Readonly<Record<string, number>> = {
  '||': PREC.LogicalOR,
  '&&': PREC.LogicalAND,
  '??': PREC.NullishCoalescing,
  '|': PREC.BitwiseOR,
  '^': PREC.BitwiseXOR,
  '&': PREC.BitwiseAND,
  '==': PREC.Equality,
  '!=': PREC.Equality,
  '===': PREC.Equality,
  '!==': PREC.Equality,
  '<': PREC.Relational,
  '>': PREC.Relational,
  '<=': PREC.Relational,
  '>=': PREC.Relational,
  in: PREC.Relational,
  instanceof: PREC.Relational,
  '<<': PREC.Shift,
  '>>': PREC.Shift,
  '>>>': PREC.Shift,
  '+': PREC.Additive,
  '-': PREC.Additive,
  '*': PREC.Multiplicative,
  '/': PREC.Multiplicative,
  '%': PREC.Multiplicative,
  '**': PREC.Exponential,
}

const binaryPrec = (op: string): number => BINARY_PRECEDENCE[op] ?? PREC.Additive

const LOGICAL_PRECEDENCE: Readonly<Record<string, number>> = {
  '??': PREC.NullishCoalescing,
  '||': PREC.LogicalOR,
  '&&': PREC.LogicalAND,
}

const logicalPrec = (op: string): number => LOGICAL_PRECEDENCE[op] ?? PREC.LogicalAND

const EVERY_COMMENT_POSITION = Number.POSITIVE_INFINITY

const sortedCommentsWithoutHashbang = (
  comments: readonly Comment[] | undefined,
  hashbang: Hashbang | null,
): readonly Comment[] => [...withoutHashbangComment(comments ?? [], hashbang)].sort((a, b) => a.start - b.start)

const withoutHashbangComment = (
  comments: readonly Comment[],
  hashbang: Hashbang | null,
): readonly Comment[] =>
  Option.match(Option.fromNullishOr(hashbang), {
    onNone: () => comments,
    onSome: (value) => comments.filter((comment) => comment.type === 'Line' && comment.start === value.start),
  })

const programText = (opts: PrintProgramOptions, program: Program): string => {
  const ctx: PrintContext = { indentLevel: 0 }
  const hashbang = opts.hashbang ?? null
  const comments = sortedCommentsWithoutHashbang(opts.comments, hashbang)
  const [headComments, cursorAfterHead] = pendingComments(comments, 0, headPosition(program))
  const [cursorAfterBody, statements] = Arr.mapAccum(
    program.body,
    cursorAfterHead,
    (cursor: number, statement: Program['body'][number]) => programStatementPart(ctx, comments, cursor, statement),
  )
  const [tailComments] = pendingComments(comments, cursorAfterBody, EVERY_COMMENT_POSITION)
  return `${hashbangPrefix(hashbang)}${headComments}${Arr.join(statements, '')}${tailComments}`
}

const headPosition = (program: Program): number =>
  Option.match(Arr.head(program.body), {
    onSome: (statement) => statement.start ?? EVERY_COMMENT_POSITION,
    onNone: () => EVERY_COMMENT_POSITION,
  })

const programStatementPart = (
  ctx: PrintContext,
  comments: readonly Comment[],
  cursor: number,
  statement: Program['body'][number],
): readonly [cursor: number, text: string] => {
  const [prefix, next] = pendingComments(comments, cursor, statement.start ?? -1)
  return [next, `${prefix}${statementText(ctx, statement)}\n`]
}

const pendingComments = (
  comments: readonly Comment[],
  cursor: number,
  pos: number,
): readonly [text: string, cursor: number] => {
  const end = Option.match(Arr.findFirstIndex(comments, (comment) => comment.start >= pos), {
    onSome: (index) => Math.max(cursor, index),
    onNone: () => comments.length,
  })
  return [comments.slice(cursor, end).map(emitComment).join(''), end]
}

const jumpStatementText = (keyword: string, label: LabelIdentifier | null): string =>
  Option.match(Option.fromNullishOr(label), {
    onSome: (value) => `${keyword} ${value.name};`,
    onNone: () => `${keyword};`,
  })

const emitComment = (comment: Comment): string =>
  Match.value(comment.type).pipe(
    Match.when('Line', () => `//${comment.value}\n`),
    Match.orElse(() => `/*${comment.value}*/\n`),
  )

const hashbangPrefix = (hashbang: Hashbang | null): string =>
  Option.match(Option.fromNullishOr(hashbang), {
    onNone: () => '',
    onSome: (value) => `#!${value.value}\n`,
  })

const statementText = (ctx: PrintContext, node: Statement): string =>
  `${attachedCommentsText(ctx, node, 'leadingComments')}${statementKindText(ctx, node)}${attachedCommentsText(
    ctx,
    node,
    'trailingComments',
  )}`

const attachedCommentsText = (
  ctx: PrintContext,
  node: CommentHost,
  field: 'leadingComments' | 'trailingComments',
): string =>
  Option.match(Option.fromNullishOr(node[field]), {
    onNone: () => '',
    onSome: (comments) => comments.map((comment) => attachedCommentText(ctx, comment, field)).join(''),
  })

const attachedCommentText = (
  ctx: PrintContext,
  comment: AttachedComment,
  field: 'leadingComments' | 'trailingComments',
): string =>
  Boolean.match(field === 'leadingComments', {
    onTrue: () => `${indent(ctx)}${commentText(comment)}\n`,
    onFalse: () => `${commentText(comment)} `,
  })

const indent = (ctx: PrintContext): string => '  '.repeat(ctx.indentLevel)

const needsParens = (childPrec: number, parentPrec: number, isRight: boolean, op?: string): boolean =>
  Boolean.match(childPrec === parentPrec, {
    onTrue: () => equalPrecedenceNeedsParens(isRight, op),
    onFalse: () => childPrec < parentPrec,
  })

const equalPrecedenceNeedsParens = (isRight: boolean, op?: string): boolean =>
  Boolean.match(op === '**', {
    onTrue: () => !isRight,
    onFalse: () => isRight,
  })

const wrapIfNeeded = (
  ctx: PrintContext,
  node: Node,
  prec: number,
  parentPrec: number,
  isRight: boolean,
  op?: string,
): string => parenthesizedIf(needsParens(prec, parentPrec, isRight, op), dispatchNode(ctx, node, prec))

const sequenceNodeText = (ctx: PrintContext, node: Node | null | undefined): string =>
  printNodePrec(ctx, node, PREC.Sequence)

const assignmentNodeText = (ctx: PrintContext, node: Node | null | undefined): string =>
  printNodePrec(ctx, node, PREC.Assignment)

const nodeListText = (ctx: PrintContext, nodes: readonly Node[], prec: number): string =>
  nodes.map((node) => dispatchNode(ctx, node, prec)).join(', ')

const wrappedExpressionText = (
  ctx: PrintContext,
  node: Node,
  prec: number,
  wrappedKinds: Readonly<Record<string, true>>,
): string => parenthesizedIf(wrappedKinds[node.type] === true, dispatchNode(ctx, node, prec))

const printNodePrec = (ctx: PrintContext, node: Node | null | undefined, prec: number): string =>
  Option.match(Option.fromNullishOr(node), {
    onNone: () => '',
    onSome: (value) => dispatchNode(ctx, value, prec),
  })

const isNode = <T extends Node['type']>(type: T) => (node: Node): node is Extract<Node, { type: T }> =>
  node.type === type

const dispatchNode = (ctx: PrintContext, node: Node, prec: number): string =>
  Match.value(node).pipe(
    Match.when(isNode('Literal'), (n) => literalText(n)),
    Match.when(isNode('Identifier'), (n) => n.name),
    Match.when(isNode('PrivateIdentifier'), (n) => `#${n.name}`),
    Match.when(isNode('ThisExpression'), () => 'this'),
    Match.when(isNode('Super'), () => 'super'),
    Match.when(isNode('ArrayExpression'), (n) => arrayExpressionText(ctx, n)),
    Match.when(isNode('ObjectExpression'), (n) => objectExpressionText(ctx, n)),
    Match.when(isNode('Property'), (n) => propertyText(ctx, n)),
    Match.when(isNode('TemplateLiteral'), (n) => templateLiteralText(ctx, n)),
    Match.when(isNode('TemplateElement'), (n) => n.value.raw),
    Match.when(isNode('TaggedTemplateExpression'), (n) => taggedTemplateText(ctx, n)),
    Match.when(isNode('MemberExpression'), (n) => memberExpressionText(ctx, n)),
    Match.when(isNode('CallExpression'), (n) => callExpressionText(ctx, n)),
    Match.when(isNode('NewExpression'), (n) => newExpressionText(ctx, n)),
    Match.when(isNode('MetaProperty'), (n) => metaPropertyText(n)),
    Match.when(isNode('SpreadElement'), (n) => `...${printNodePrec(ctx, n.argument, PREC.Assignment)}`),
    Match.when(isNode('RestElement'), (n) => `...${printNodePrec(ctx, n.argument, PREC.Assignment)}`),
    Match.when(isNode('UpdateExpression'), (n) => updateExpressionText(ctx, n)),
    Match.when(isNode('UnaryExpression'), (n) => unaryExpressionText(ctx, n)),
    Match.when(isNode('BinaryExpression'), (n) => binaryExpressionText(ctx, n, prec)),
    Match.when(isNode('LogicalExpression'), (n) => logicalExpressionText(ctx, n, prec)),
    Match.when(isNode('ConditionalExpression'), (n) => conditionalExpressionText(ctx, n, prec)),
    Match.when(isNode('AssignmentExpression'), (n) => assignmentExpressionText(ctx, n, prec)),
    Match.when(isNode('AssignmentPattern'), (n) => assignmentPatternText(ctx, n, prec)),
    Match.when(isNode('ObjectPattern'), (n) => objectPatternText(ctx, n)),
    Match.when(isNode('ArrayPattern'), (n) => arrayPatternText(ctx, n)),
    Match.when(isNode('SequenceExpression'), (n) => sequenceExpressionText(ctx, n, prec)),
    Match.when(isNode('AwaitExpression'), (n) => `await ${printNodePrec(ctx, n.argument, PREC.Unary)}`),
    Match.when(isNode('YieldExpression'), (n) => yieldExpressionText(ctx, n)),
    Match.when(isNode('ChainExpression'), (n) => printNodePrec(ctx, n.expression, prec)),
    Match.when(isNode('ParenthesizedExpression'), (n) => `(${printNodePrec(ctx, n.expression, PREC.Sequence)})`,
    ),
    Match.when(isNode('ImportExpression'), (n) => importExpressionText(ctx, n)),
    Match.when(isNode('V8IntrinsicExpression'), (n) => v8IntrinsicText(ctx, n)),
    Match.when(isNode('ArrowFunctionExpression'), (n) => arrowFunctionText(ctx, n, prec)),
    Match.when(isNode('FunctionDeclaration'), (n) => functionText(ctx, n)),
    Match.when(isNode('FunctionExpression'), (n) => functionText(ctx, n)),
    Match.when(isNode('TSDeclareFunction'), (n) => functionText(ctx, n)),
    Match.when(isNode('TSEmptyBodyFunctionExpression'), (n) => functionText(ctx, n)),
    Match.when(isNode('ClassDeclaration'), (n) => classText(ctx, n)),
    Match.when(isNode('ClassExpression'), (n) => classText(ctx, n)),
    Match.when(isNode('JSXElement'), (n) => jsxElementText(ctx, n)),
    Match.when(isNode('JSXFragment'), (n) => jsxFragmentText(ctx, n)),
    Match.when(isNode('JSXOpeningElement'), (n) => jsxOpeningElementText(ctx, n)),
    Match.when(isNode('JSXClosingElement'), () => ''),
    Match.when(isNode('JSXIdentifier'), (n) => n.name),
    Match.when(isNode('JSXNamespacedName'), (n) => `${n.namespace.name}:${n.name.name}`),
    Match.when(isNode('JSXMemberExpression'), (n) => jsxMemberExpressionText(n)),
    Match.when(isNode('JSXAttribute'), (n) => jsxAttributeText(ctx, n)),
    Match.when(isNode('JSXSpreadAttribute'), (n) => `{...${printNodePrec(ctx, n.argument, PREC.Assignment)}}`,
    ),
    Match.when(isNode('JSXExpressionContainer'), (n) => `{${printNodePrec(ctx, n.expression, PREC.Sequence)}}`,
    ),
    Match.when(isNode('JSXEmptyExpression'), () => ''),
    Match.when(isNode('JSXText'), (n) => n.value),
    Match.when(isNode('JSXSpreadChild'), (n) => `{...${printNodePrec(ctx, n.expression, PREC.Assignment)}}`),
    Match.when(isNode('TSAsExpression'), (n) => tsAsExpressionText(ctx, n, prec)),
    Match.when(isNode('TSSatisfiesExpression'), (n) => tsSatisfiesExpressionText(ctx, n, prec)),
    Match.when(isNode('TSTypeAssertion'), (n) => tsTypeAssertionText(ctx, n)),
    Match.when(isNode('TSNonNullExpression'), (n) => `${printNodePrec(ctx, n.expression, PREC.Member)}!`),
    Match.when(isNode('TSInstantiationExpression'), (n) => tsInstantiationExpressionText(ctx, n)),
    Match.when(isNode('BlockStatement'), (n) => blockStatementText(ctx, n)),
    Match.when(isNode('EmptyStatement'), () => ';'),
    Match.when(isNode('ExpressionStatement'), (n) => expressionStatementText(ctx, n)),
    Match.when(isNode('IfStatement'), (n) => ifStatementText(ctx, n)),
    Match.when(isNode('DoWhileStatement'), (n) => doWhileStatementText(ctx, n)),
    Match.when(isNode('WhileStatement'), (n) => whileStatementText(ctx, n)),
    Match.when(isNode('ForStatement'), (n) => forStatementText(ctx, n)),
    Match.when(isNode('ForInStatement'), (n) => forInStatementText(ctx, n)),
    Match.when(isNode('ForOfStatement'), (n) => forOfStatementText(ctx, n)),
    Match.when(isNode('ContinueStatement'), (n) => jumpStatementText('continue', n.label)),
    Match.when(isNode('BreakStatement'), (n) => jumpStatementText('break', n.label)),
    Match.when(isNode('ReturnStatement'), (n) => returnStatementText(ctx, n)),
    Match.when(isNode('WithStatement'), (n) => withStatementText(ctx, n)),
    Match.when(isNode('SwitchStatement'), (n) => switchStatementText(ctx, n)),
    Match.when(isNode('SwitchCase'), () => ''),
    Match.when(isNode('LabeledStatement'), (n) => labeledStatementText(ctx, n)),
    Match.when(isNode('ThrowStatement'), (n) => `throw ${printNodePrec(ctx, n.argument, PREC.Sequence)};`),
    Match.when(isNode('TryStatement'), (n) => tryStatementText(ctx, n)),
    Match.when(isNode('CatchClause'), () => ''),
    Match.when(isNode('DebuggerStatement'), () => 'debugger;'),
    Match.when(isNode('VariableDeclaration'), (n) => variableDeclarationText(ctx, n)),
    Match.when(isNode('VariableDeclarator'), (n) => variableDeclaratorText(ctx, n)),
    Match.when(isNode('ClassBody'), (n) => classBodyText(ctx, n)),
    Match.when(isNode('MethodDefinition'), (n) => methodDefinitionText(ctx, n)),
    Match.when(isNode('TSAbstractMethodDefinition'), (n) => methodDefinitionText(ctx, n)),
    Match.when(isNode('PropertyDefinition'), (n) => propertyDefinitionText(ctx, n)),
    Match.when(isNode('TSAbstractPropertyDefinition'), (n) => propertyDefinitionText(ctx, n)),
    Match.when(isNode('AccessorProperty'), (n) => accessorPropertyText(ctx, n)),
    Match.when(isNode('TSAbstractAccessorProperty'), (n) => accessorPropertyText(ctx, n)),
    Match.when(isNode('StaticBlock'), (n) => staticBlockText(ctx, n)),
    Match.when(isNode('ImportDeclaration'), (n) => importDeclarationText(ctx, n)),
    Match.when(isNode('ExportNamedDeclaration'), (n) => exportNamedDeclarationText(ctx, n)),
    Match.when(isNode('ExportDefaultDeclaration'), (n) => exportDefaultDeclarationText(ctx, n)),
    Match.when(isNode('ExportAllDeclaration'), (n) => exportAllDeclarationText(ctx, n)),
    Match.when(isNode('Decorator'), (n) => `@${printNodePrec(ctx, n.expression, PREC.Member)}`),
    Match.when(isNode('TSTypeAliasDeclaration'), (n) => tsTypeAliasDeclarationText(ctx, n)),
    Match.when(isNode('TSInterfaceDeclaration'), (n) => tsInterfaceDeclarationText(ctx, n)),
    Match.when(isNode('TSEnumDeclaration'), (n) => tsEnumDeclarationText(ctx, n)),
    Match.when(isNode('TSModuleDeclaration'), (n) => tsModuleDeclarationText(ctx, n)),
    Match.when(isNode('TSImportEqualsDeclaration'), (n) => tsImportEqualsDeclarationText(ctx, n)),
    Match.when(isNode('TSExportAssignment'), (n) => `export = ${printNodePrec(ctx, n.expression, PREC.Sequence)};`,
    ),
    Match.when(isNode('TSNamespaceExportDeclaration'), (n) => `export as namespace ${n.id.name};`),
    Match.when(isNode('TSTypeAnnotation'), (n) => `: ${printTSTypeToString(ctx, n.typeAnnotation)}`),
    Match.when(isNode('TSTypeParameterDeclaration'), (n) => printTSTypeParameterDeclaration(ctx, n)),
    Match.when(isNode('TSTypeParameterInstantiation'), (n) => printTSTypeParameterInstantiation(ctx, n)),
    Match.when(isNode('TSTypeParameter'), (n) => printTSTypeParameter(ctx, n)),
    Match.when(isTSType, (n) => printTSTypeToString(ctx, n)),
    Match.orElse((n) => `/* unknown:${n.type} */`),
  )

const statementKindText = (ctx: PrintContext, node: Statement): string =>
  Match.value(node).pipe(
    Match.when(isNode('BlockStatement'), (n) => blockStatementText(ctx, n)),
    Match.when(isNode('VariableDeclaration'), (n) => `${variableDeclarationText(ctx, n)};`),
    Match.when(isNode('FunctionDeclaration'), (n) => functionText(ctx, n)),
    Match.when(isNode('FunctionExpression'), (n) => functionText(ctx, n)),
    Match.when(isNode('TSDeclareFunction'), (n) => functionText(ctx, n)),
    Match.when(isNode('TSEmptyBodyFunctionExpression'), (n) => functionText(ctx, n)),
    Match.when(isNode('ClassDeclaration'), (n) => classText(ctx, n)),
    Match.when(isNode('ClassExpression'), (n) => classText(ctx, n)),
    Match.when(isNode('ExpressionStatement'), (n) => expressionStatementText(ctx, n)),
    Match.when(isNode('IfStatement'), (n) => ifStatementText(ctx, n)),
    Match.when(isNode('ForStatement'), (n) => forStatementText(ctx, n)),
    Match.when(isNode('ForInStatement'), (n) => forInStatementText(ctx, n)),
    Match.when(isNode('ForOfStatement'), (n) => forOfStatementText(ctx, n)),
    Match.when(isNode('WhileStatement'), (n) => whileStatementText(ctx, n)),
    Match.when(isNode('DoWhileStatement'), (n) => doWhileStatementText(ctx, n)),
    Match.when(isNode('ReturnStatement'), (n) => returnStatementText(ctx, n)),
    Match.when(isNode('ThrowStatement'), (n) => `throw ${printNodePrec(ctx, n.argument, PREC.Sequence)};`),
    Match.when(isNode('TryStatement'), (n) => tryStatementText(ctx, n)),
    Match.when(isNode('SwitchStatement'), (n) => switchStatementText(ctx, n)),
    Match.when(isNode('LabeledStatement'), (n) => labeledStatementText(ctx, n)),
    Match.when(isNode('BreakStatement'), (n) => printNodePrec(ctx, n, PREC.Sequence)),
    Match.when(isNode('ContinueStatement'), (n) => printNodePrec(ctx, n, PREC.Sequence)),
    Match.when(isNode('DebuggerStatement'), (n) => printNodePrec(ctx, n, PREC.Sequence)),
    Match.when(isNode('EmptyStatement'), (n) => printNodePrec(ctx, n, PREC.Sequence)),
    Match.when(isNode('WithStatement'), (n) => withStatementText(ctx, n)),
    Match.when(isNode('ImportDeclaration'), (n) => importDeclarationText(ctx, n)),
    Match.when(isNode('ExportNamedDeclaration'), (n) => exportNamedDeclarationText(ctx, n)),
    Match.when(isNode('ExportDefaultDeclaration'), (n) => exportDefaultDeclarationText(ctx, n)),
    Match.when(isNode('ExportAllDeclaration'), (n) => exportAllDeclarationText(ctx, n)),
    Match.when(isNode('TSTypeAliasDeclaration'), (n) => tsTypeAliasDeclarationText(ctx, n)),
    Match.when(isNode('TSInterfaceDeclaration'), (n) => tsInterfaceDeclarationText(ctx, n)),
    Match.when(isNode('TSEnumDeclaration'), (n) => tsEnumDeclarationText(ctx, n)),
    Match.when(isNode('TSModuleDeclaration'), (n) => tsModuleDeclarationText(ctx, n)),
    Match.when(isNode('TSImportEqualsDeclaration'), (n) => tsImportEqualsDeclarationText(ctx, n)),
    Match.when(isNode('TSExportAssignment'), (n) => printNodePrec(ctx, n, PREC.Sequence)),
    Match.when(isNode('TSNamespaceExportDeclaration'), (n) => printNodePrec(ctx, n, PREC.Sequence)),
    Match.orElse(() => ''),
  )

const literalText = <A = unknown>(node: LiteralSource<A>): string => node.raw ?? literalWithoutRaw(node)

const literalWithoutRaw = <A = unknown>(node: LiteralSource<A>): string =>
  Option.match(Option.fromNullishOr(node.regex), {
    onSome: (regex) => `/${regex.pattern}/${regex.flags}`,
    onNone: () => literalWithoutRegex(node),
  })

const literalWithoutRegex = <A = unknown>(node: LiteralSource<A>): string =>
  Option.match(Option.fromNullishOr(node.bigint), {
    onSome: (bigint) => bigint,
    onNone: () => valueLiteralText(node.value),
  })

const valueLiteralText = <A = unknown>(value: A): string =>
  Match.value(value).pipe(
    Match.when(Match.string, (v) => JSON.stringify(v)),
    Match.orElse(nonStringLiteralText),
  )

const nonStringLiteralText = <A = unknown>(value: A): string =>
  Match.value(value).pipe(
    Match.when(Match.number, (v) => String(v)),
    Match.orElse(booleanOrBigintText),
  )

const booleanOrBigintText = <A = unknown>(value: A): string =>
  Match.value(value).pipe(
    Match.when(Match.boolean, (v) => String(v)),
    Match.orElse(bigintText),
  )

const bigintText = <A = unknown>(value: A): string =>
  Match.value(value).pipe(
    Match.when((candidate): candidate is bigint => typeof candidate === 'bigint', (v) => `${v}n`),
    Match.orElse(() => 'null'),
  )

const flagText = <A = unknown>(present: A, text: string): string =>
  Boolean.match(Boolean(present), {
    onTrue: () => text,
    onFalse: () => '',
  })

const parenthesizedIf = (wrap: boolean, text: string): string =>
  Boolean.match(wrap, {
    onTrue: () => `(${text})`,
    onFalse: () => text,
  })

const arrayExpressionText = (ctx: PrintContext, node: ArrayExpression): string =>
  `[${node.elements.map((element) => printNodePrec(ctx, element, PREC.Assignment)).join(', ')}]`

const objectExpressionText = (ctx: PrintContext, node: ObjectExpression): string =>
  Boolean.match(node.properties.length === 0, {
    onTrue: () => '{}',
    onFalse: () => `{ ${nodeListText(ctx, node.properties, PREC.Sequence)} }`,
  })

type PropertyForm = 'accessor' | 'method' | 'shorthand' | 'shorthandDefault' | 'verbose'

const propertyText = (ctx: PrintContext, node: PropertyLike): string =>
  Match.value(propertyFormOf(node)).pipe(
    Match.when('accessor', () => `${node.kind} ${propertyKeyText(ctx, node.key, node.computed === true, PREC.Assignment)}${functionValueTailText(ctx, node.value)}`),
    Match.when('method', () => `${propertyKeyText(ctx, node.key, node.computed === true, PREC.Assignment)}${functionValueTailText(ctx, node.value)}`),
    Match.when('shorthand', () => identifierNameText(node.key)),
    Match.when('shorthandDefault', () => shorthandDefaultPropertyText(ctx, node)),
    Match.orElse(
      () => `${propertyKeyText(ctx, node.key, node.computed === true, PREC.Assignment)}: ${printNodePrec(ctx, node.value, PREC.Assignment)}`,
    ),
  )

const functionValueTailText = (ctx: PrintContext, value: Node): string =>
  Match.value(value).pipe(
    Match.when(isFunctionNode, (fn) => functionTailText(ctx, fn)),
    Match.orElse(() => ''),
  )

const shorthandDefaultPropertyText = (ctx: PrintContext, node: PropertyLike): string =>
  Match.value(node.value).pipe(
    Match.when(
      isAssignmentPattern,
      (value) => `${identifierNameText(node.key)} = ${printNodePrec(ctx, value.right, PREC.Assignment)}`,
    ),
    Match.orElse(() => ''),
  )

const propertyKeyText = (ctx: PrintContext, key: Node, computed: boolean, computedPrec: number): string =>
  Boolean.match(computed, {
    onTrue: () => `[${dispatchNode(ctx, key, computedPrec)}]`,
    onFalse: () => plainPropertyKeyText(ctx, key),
  })

const plainPropertyKeyText = (ctx: PrintContext, key: Node): string =>
  Match.value(key).pipe(
    Match.when(isNode('Identifier'), (n) => identifierNameText(n)),
    Match.when(isNode('PrivateIdentifier'), (n) => privateIdentifierText(n)),
    Match.when(isNode('Literal'), (n) => literalText(n)),
    Match.orElse((n) => dispatchNode(ctx, n, PREC.Assignment)),
  )

const functionTailText = (ctx: PrintContext, fn: FunctionNode): string =>
  `${typeParametersText(ctx, fn.typeParameters)}(${paramsText(ctx, fn.params)})${typeAnnotationText(
    ctx,
    fn.returnType,
  )}${functionBodyText(ctx, fn)}`

const functionBodyText = (ctx: PrintContext, fn: FunctionNode): string =>
  Option.match(Option.fromNullishOr(fn.body), {
    onSome: (body) => ` ${blockStatementText(ctx, body)}`,
    onNone: () => ';',
  })

const paramsText = (ctx: PrintContext, params: readonly ParamPattern[]): string =>
  params.map((param) => paramText(ctx, param)).join(', ')

const typeParametersText = (ctx: PrintContext, params: TSTypeParameterDeclaration | null | undefined): string =>
  Option.match(Option.fromNullishOr(params), {
    onNone: () => '',
    onSome: (value) => printTSTypeParameterDeclaration(ctx, value),
  })

const typeArgumentsText = (ctx: PrintContext, args: TSTypeParameterInstantiation | null | undefined): string =>
  Option.match(Option.fromNullishOr(args), {
    onNone: () => '',
    onSome: (value) => printTSTypeParameterInstantiation(ctx, value),
  })

const typeAnnotationText = (ctx: PrintContext, annotation: TSTypeAnnotation | null | undefined): string =>
  Option.match(Option.fromNullishOr(annotation), {
    onNone: () => '',
    onSome: (value) => printTSTypeAnnotation(ctx, value),
  })

const templateLiteralText = (ctx: PrintContext, node: TemplateLiteral): string =>
  `\`${node.quasis
    .map((quasi, index) => quasiText(ctx, quasi, node.expressions[index]))
    .join('')}\``

const quasiText = (ctx: PrintContext, quasi: TemplateElement, expression: Expression | undefined): string =>
  Boolean.match(quasi.tail, {
    onTrue: () => quasi.value.raw,
    onFalse: () => `${quasi.value.raw}\${${sequenceNodeText(ctx, expression)}}`,
  })

const taggedTemplateText = (ctx: PrintContext, node: TaggedTemplateExpression): string =>
  `${printNodePrec(ctx, node.tag, PREC.Member)}${typeArgumentsText(ctx, node.typeArguments)}${templateLiteralText(
    ctx,
    node.quasi,
  )}`

const memberExpressionText = (ctx: PrintContext, node: MemberExpression): string =>
  `${wrappedExpressionText(ctx, node.object, PREC.Member, MEMBER_OBJECT_WRAPPED_KINDS)}${flagText(
    node.optional,
    '?.',
  )}${memberSelectorText(ctx, node)}`

const memberSelectorText = (ctx: PrintContext, access: MemberExpression): string =>
  Boolean.match(access.computed, {
    onTrue: () => `[${sequenceNodeText(ctx, access.property)}]`,
    onFalse: () => `${flagText(!access.optional, '.')}${memberPropertyText(ctx, access.property)}`,
  })

const memberPropertyText = (ctx: PrintContext, property: Node): string =>
  Match.value(property).pipe(
    Match.when(isNode('Identifier'), (n) => identifierNameText(n)),
    Match.when(isNode('PrivateIdentifier'), (n) => privateIdentifierText(n)),
    Match.orElse((n) => sequenceNodeText(ctx, n)),
  )

const callExpressionText = (ctx: PrintContext, node: CallExpression): string =>
  `${wrappedExpressionText(ctx, node.callee, PREC.Member, CALLEE_WRAPPED_KINDS)}${flagText(
    node.optional,
    '?.',
  )}${typeArgumentsText(ctx, node.typeArguments)}(${nodeListText(ctx, node.arguments, PREC.Assignment)})`

const newExpressionText = (ctx: PrintContext, node: NewExpression): string =>
  `new ${dispatchNode(ctx, node.callee, PREC.Member)}${typeArgumentsText(ctx, node.typeArguments)}(${nodeListText(
    ctx,
    node.arguments,
    PREC.Assignment,
  )})`

const metaPropertyText = (node: MetaProperty): string => `${node.meta.name}.${node.property.name}`

const v8IntrinsicText = (
  ctx: PrintContext,
  node: { readonly name: { readonly name: string }; readonly arguments: readonly Node[] },
): string => `%${node.name.name}(${nodeListText(ctx, node.arguments, PREC.Assignment)})`

const importExpressionText = (ctx: PrintContext, node: ImportExpression): string =>
  `import${flagText(node.phase, `.${node.phase}`)}(${assignmentNodeText(ctx, node.source)}${flagText(
    node.options,
    `, ${assignmentNodeText(ctx, node.options)}`,
  )})`

const updateExpressionText = (ctx: PrintContext, node: UpdateExpression): string => {
  const operand = wrappedExpressionText(ctx, node.argument, PREC.Update, MEMBER_OBJECT_WRAPPED_KINDS)
  return Boolean.match(node.prefix, {
    onTrue: () => `${node.operator}${operand}`,
    onFalse: () => `${operand}${node.operator}`,
  })
}

const unaryExpressionText = (ctx: PrintContext, node: UnaryExpression): string =>
  `${node.operator}${flagText(UNARY_WORD_OPERATORS[node.operator] === true, ' ')}${wrappedExpressionText(
    ctx,
    node.argument,
    PREC.Unary,
    UNARY_OPERAND_WRAPPED_KINDS,
  )}`

const binaryExpressionText = (ctx: PrintContext, node: BinaryLike, prec: number): string => {
  const myPrec = binaryPrec(node.operator)
  const leftStr = wrapIfNeeded(ctx, node.left, precOf(node.left), myPrec, false, node.operator)
  const rightStr = wrapIfNeeded(ctx, node.right, precOf(node.right), myPrec, true, node.operator)
  return parenthesizedIf(myPrec < prec, `${leftStr} ${node.operator} ${rightStr}`)
}

const logicalExpressionText = (ctx: PrintContext, node: LogicalExpression, prec: number): string => {
  const myPrec = logicalPrec(node.operator)
  const leftStr = wrapIfNeeded(ctx, node.left, precOf(node.left), myPrec, false, node.operator)
  const rightStr = wrapIfNeeded(ctx, node.right, precOf(node.right), myPrec, true, node.operator)
  return parenthesizedIf(myPrec < prec, `${leftStr} ${node.operator} ${rightStr}`)
}

const conditionalExpressionText = (ctx: PrintContext, node: ConditionalExpression, prec: number): string => {
  const myPrec = PREC.Conditional
  const testStr = wrapIfNeeded(ctx, node.test, precOf(node.test), myPrec, false)
  const consStr = dispatchNode(ctx, node.consequent, PREC.Assignment)
  const altStr = dispatchNode(ctx, node.alternate, PREC.Assignment)
  return parenthesizedIf(myPrec < prec, `${testStr} ? ${consStr} : ${altStr}`)
}

const assignmentExpressionText = (ctx: PrintContext, node: AssignmentExpression, prec: number): string => {
  const myPrec = PREC.Assignment
  const leftStr = dispatchNode(ctx, node.left, myPrec)
  const rightStr = dispatchNode(ctx, node.right, myPrec - 0.1)
  return parenthesizedIf(myPrec < prec, `${leftStr} ${node.operator} ${rightStr}`)
}

const assignmentPatternText = (
  ctx: PrintContext,
  node: Extract<Node, { type: 'AssignmentPattern' }>,
  prec: number,
): string =>
  parenthesizedIf(
    PREC.Assignment < prec,
    `${dispatchNode(ctx, node.left, PREC.Assignment)}${typeAnnotationText(ctx, bindingTypeAnnotation(node.left))} = ${dispatchNode(ctx, node.right, PREC.Assignment)}`,
  )

const objectPatternText = (ctx: PrintContext, node: { readonly properties: readonly Node[] }): string =>
  Boolean.match(node.properties.length === 0, {
    onTrue: () => '{}',
    onFalse: () => `{ ${nodeListText(ctx, node.properties, PREC.Sequence)} }`,
  })

const arrayPatternText = (ctx: PrintContext, node: Extract<Node, { type: 'ArrayPattern' }>): string =>
  `[${node.elements.map((element) => printNodePrec(ctx, element, PREC.Assignment)).join(', ')}]`

const sequenceExpressionText = (ctx: PrintContext, node: SequenceExpression, prec: number): string =>
  parenthesizedIf(
    PREC.Sequence < prec,
    node.expressions.map((expression) => dispatchNode(ctx, expression, PREC.Sequence)).join(', '),
  )

const yieldExpressionText = (ctx: PrintContext, node: YieldExpression): string =>
  `${Boolean.match(node.delegate, {
    onTrue: () => 'yield*',
    onFalse: () => 'yield',
  })}${flagText(node.argument, ` ${assignmentNodeText(ctx, node.argument)}`)}`

const arrowFunctionText = (ctx: PrintContext, node: ArrowFunctionExpression, prec: number): string =>
  parenthesizedIf(
    PREC.Assignment < prec,
    `${flagText(node.async, 'async ')}${typeParametersText(ctx, node.typeParameters)}${arrowParamsText(
      ctx,
      node,
    )}${typeAnnotationText(ctx, node.returnType)} => ${arrowBodyText(ctx, node)}`,
  )

const arrowParamsText = (ctx: PrintContext, node: ArrowFunctionExpression): string => {
  const bareParam = bareArrowParamName(node)
  return Boolean.match(bareParam.length === 0, {
    onTrue: () => `(${paramsText(ctx, node.params)})`,
    onFalse: () => bareParam,
  })
}

const arrowBodyText = (ctx: PrintContext, node: ArrowFunctionExpression): string =>
  Match.value(node.body).pipe(
    Match.when(isNode('BlockStatement'), (body) => blockStatementText(ctx, body)),
    Match.orElse((body) => assignmentNodeText(ctx, body)),
  )

const functionText = (ctx: PrintContext, node: FunctionNode): string =>
  `${functionHeaderText(node)}${functionTailText(ctx, node)}`

const classText = (ctx: PrintContext, node: Class): string =>
  `${decoratorsText(ctx, node.decorators)}${flagText(node.declare, 'declare ')}${flagText(
    node.abstract,
    'abstract ',
  )}class${namedDeclarationText(node)}${typeParametersText(ctx, node.typeParameters)}${classHeritageText(
    ctx,
    node,
  )}${classImplementsText(ctx, node)} ${classBodyText(ctx, node.body)}`

const classHeritageText = (ctx: PrintContext, node: Class): string =>
  Option.match(Option.fromNullishOr(node.superClass), {
    onSome: (superClass) =>
      ` extends ${assignmentNodeText(ctx, superClass)}${typeArgumentsText(ctx, node.superTypeArguments)}`,
    onNone: () => '',
  })

const classImplementsText = (ctx: PrintContext, node: Class): string => {
  const rendered = (node.implements ?? []).map((heritage) => heritageText(ctx, heritage)).join(', ')
  return flagText(rendered, ` implements ${rendered}`)
}

const heritageText = (
  ctx: PrintContext,
  heritage: {
    readonly expression: Node
    readonly typeArguments?: TSTypeParameterInstantiation | null
  },
): string => `${assignmentNodeText(ctx, heritage.expression)}${typeArgumentsText(ctx, heritage.typeArguments)}`

const decoratorsText = (ctx: PrintContext, decorators: readonly Decorator[] | undefined): string => {
  const rendered = (decorators ?? []).map((decorator) => decoratorText(ctx, decorator)).join(' ')
  return flagText(rendered, `${rendered} `)
}

const decoratorText = (ctx: PrintContext, decorator: Decorator): string =>
  `@${dispatchNode(ctx, decorator.expression, PREC.Member)}`

const jsxElementText = (ctx: PrintContext, node: JSXElement): string =>
  `${jsxOpeningElementText(ctx, node.openingElement)}${node.children
    .map((child) => jsxChildText(ctx, child))
    .join('')}${jsxClosingElementText(ctx, node)}`

const jsxClosingElementText = (ctx: PrintContext, node: JSXElement): string =>
  Option.match(Option.fromNullishOr(node.closingElement), {
    onSome: (closingElement) => `</${jsxElementNameText(ctx, closingElement.name)}>`,
    onNone: () => '',
  })

const jsxFragmentText = (ctx: PrintContext, node: JSXFragment): string =>
  `<>${node.children.map((child) => jsxChildText(ctx, child)).join('')}</>`

const jsxOpeningElementText = (ctx: PrintContext, node: JSXOpeningElement): string =>
  `<${jsxElementNameText(ctx, node.name)}${typeArgumentsText(ctx, node.typeArguments)}${node.attributes
    .map((attribute) => ` ${sequenceNodeText(ctx, attribute)}`)
    .join('')}${Boolean.match(node.selfClosing, {
    onTrue: () => ' />',
    onFalse: () => '>',
  })}`

const jsxElementNameText = (ctx: PrintContext, name: JSXOpeningElement['name']): string =>
  Match.value(name).pipe(
    Match.when(isNode('JSXIdentifier'), (n) => n.name),
    Match.when(isNode('JSXNamespacedName'), (n) => `${n.namespace.name}:${n.name.name}`),
    Match.when(isNode('JSXMemberExpression'), (n) => jsxMemberExpressionText(n)),
    Match.orElse(() => ''),
  )

const jsxMemberExpressionText = (node: JSXMemberExpression): string =>
  Match.value(node.object).pipe(
    Match.when(isNode('JSXIdentifier'), (obj) => `${obj.name}.${node.property.name}`),
    Match.orElse((obj) => `${jsxMemberExpressionText(obj)}.${node.property.name}`),
  )

const jsxAttributeText = (ctx: PrintContext, node: JSXAttribute): string =>
  `${jsxAttributeNameText(node.name)}${jsxAttributeValueClauseText(ctx, node.value)}`

const jsxAttributeValueClauseText = (ctx: PrintContext, value: JSXAttribute['value']): string =>
  Option.match(Option.fromNullishOr(value), {
    onSome: (nonNull) => `=${jsxAttributeValueText(ctx, nonNull)}`,
    onNone: () => '',
  })

const jsxAttributeValueText = (ctx: PrintContext, value: NonNullable<JSXAttribute['value']>): string =>
  Match.value(value).pipe(
    Match.when(isNode('Literal'), (n) => literalText(n)),
    Match.when(isNode('JSXExpressionContainer'), (n) => `{${sequenceNodeText(ctx, n.expression)}}`),
    Match.when(isNode('JSXElement'), (n) => sequenceNodeText(ctx, n)),
    Match.when(isNode('JSXFragment'), (n) => sequenceNodeText(ctx, n)),
    Match.orElse(() => ''),
  )

const jsxChildText = (ctx: PrintContext, child: JSXElement['children'][number]): string =>
  Match.value(child).pipe(
    Match.when(isNode('JSXText'), (n) => n.value),
    Match.when(isNode('JSXElement'), (n) => jsxElementText(ctx, n)),
    Match.when(isNode('JSXFragment'), (n) => jsxFragmentText(ctx, n)),
    Match.when(isNode('JSXExpressionContainer'), (n) => `{${printNodePrec(ctx, n.expression, PREC.Sequence)}}`,
    ),
    Match.when(isNode('JSXSpreadChild'), (n) => `{...${printNodePrec(ctx, n.expression, PREC.Assignment)}}`),
    Match.orElse(() => ''),
  )

const tsAsExpressionText = (ctx: PrintContext, node: TSAsExpression, prec: number): string => {
  const myPrec = PREC.Relational
  return parenthesizedIf(
    myPrec < prec,
    `${dispatchNode(ctx, node.expression, myPrec)} as ${printTSTypeToString(ctx, node.typeAnnotation)}`,
  )
}

const tsSatisfiesExpressionText = (ctx: PrintContext, node: TSSatisfiesExpression, prec: number): string => {
  const myPrec = PREC.Relational
  return parenthesizedIf(
    myPrec < prec,
    `${dispatchNode(ctx, node.expression, myPrec)} satisfies ${printTSTypeToString(ctx, node.typeAnnotation)}`,
  )
}

const tsTypeAssertionText = (ctx: PrintContext, node: TSTypeAssertion): string =>
  `<${printTSTypeToString(ctx, node.typeAnnotation)}>${printNodePrec(ctx, node.expression, PREC.Unary)}`

const tsInstantiationExpressionText = (ctx: PrintContext, node: TSInstantiationExpression): string =>
  `${printNodePrec(ctx, node.expression, PREC.Member)}${printTSTypeParameterInstantiation(ctx, node.typeArguments)}`

const blockStatementText = (ctx: PrintContext, node: Extract<Node, { type: 'BlockStatement' }>): string =>
  Boolean.match(node.body.length === 0, {
    onTrue: () => '{}',
    onFalse: () => `{\n${indentedBodyText(ctx, node.body, statementText)}${indent(ctx)}}`,
  })

const expressionStatementText = (ctx: PrintContext, node: ExpressionStatement): string =>
  Boolean.match(isDirective(node.directive), {
    onTrue: () => `${JSON.stringify(node.directive)};`,
    onFalse: () => `${printNodePrec(ctx, node.expression, PREC.Sequence)};`,
  })

const isDirective = (directive: string | null | undefined): boolean =>
  directive != null && directive !== ''

const ifStatementText = (ctx: PrintContext, node: IfStatement): string =>
  `if (${printNodePrec(ctx, node.test, PREC.Sequence)}) ${statementOrBlockText(ctx, node.consequent)}${Option.match(
    Option.fromNullishOr(node.alternate),
    {
      onSome: (alternate) => ` else ${statementOrBlockText(ctx, alternate)}`,
      onNone: () => '',
    },
  )}`

const statementOrBlockText = (ctx: PrintContext, node: Statement): string =>
  Match.value(node).pipe(
    Match.when(isNode('BlockStatement'), (n) => blockStatementText(ctx, n)),
    Match.orElse((n) => statementText(ctx, n)),
  )

const whileStatementText = (ctx: PrintContext, node: WhileStatement): string =>
  `while (${printNodePrec(ctx, node.test, PREC.Sequence)}) ${statementOrBlockText(ctx, node.body)}`

const doWhileStatementText = (ctx: PrintContext, node: DoWhileStatement): string =>
  `do ${statementOrBlockText(ctx, node.body)} while (${printNodePrec(ctx, node.test, PREC.Sequence)});`

const forStatementText = (ctx: PrintContext, node: ForStatement): string =>
  `for (${declarationOrExpressionText(ctx, node.init)}; ${optionalSequenceText(ctx, node.test)}; ${optionalSequenceText(
    ctx,
    node.update,
  )}) ${statementOrBlockText(ctx, node.body)}`

const declarationOrExpressionText = (ctx: PrintContext, node: Node | null | undefined): string =>
  Option.match(Option.fromNullishOr(node), {
    onNone: () => '',
    onSome: (value) =>
      Match.value(value).pipe(
        Match.when(isNode('VariableDeclaration'), (n) => variableDeclarationText(ctx, n)),
        Match.orElse((n) => printNodePrec(ctx, n, PREC.Sequence)),
      ),
  })

const optionalSequenceText = (ctx: PrintContext, node: Node | null | undefined): string =>
  sequenceNodeText(ctx, node)

const forInStatementText = (ctx: PrintContext, node: ForInStatement): string =>
  `for (${Match.value(node.left).pipe(
    Match.when(isNode('VariableDeclaration'), (n) => variableDeclarationText(ctx, n)),
    Match.orElse((n) => printNodePrec(ctx, n, PREC.Sequence)),
  )} in ${printNodePrec(ctx, node.right, PREC.Sequence)}) ${statementOrBlockText(ctx, node.body)}`

const forOfStatementText = (ctx: PrintContext, node: ForOfStatement): string =>
  `${Boolean.match(node.await, {
    onTrue: () => 'for await (',
    onFalse: () => 'for (',
  })}${declarationOrExpressionText(ctx, node.left)} of ${sequenceNodeText(ctx, node.right)}) ${statementOrBlockText(
    ctx,
    node.body,
  )}`

const returnStatementText = (ctx: PrintContext, node: ReturnStatement): string =>
  Option.match(Option.fromNullishOr(node.argument), {
    onSome: (argument) => `return ${printNodePrec(ctx, argument, PREC.Sequence)};`,
    onNone: () => 'return;',
  })

const withStatementText = (ctx: PrintContext, node: WithStatement): string =>
  `with (${printNodePrec(ctx, node.object, PREC.Sequence)}) ${statementOrBlockText(ctx, node.body)}`

const switchStatementText = (ctx: PrintContext, node: SwitchStatement): string => {
  const inner: PrintContext = { indentLevel: ctx.indentLevel + 1 }
  return `switch (${sequenceNodeText(ctx, node.discriminant)}) {\n${node.cases
    .map((switchCase) => `${indent(inner)}${switchCaseText(inner, switchCase)}`)
    .join('')}${indent(ctx)}}`
}

const switchCaseText = (ctx: PrintContext, node: SwitchCase): string =>
  `${switchCaseHeaderText(ctx, node)}${indentedBodyText(ctx, node.consequent, statementText)}`

const switchCaseHeaderText = (ctx: PrintContext, node: SwitchCase): string =>
  Option.match(Option.fromNullishOr(node.test), {
    onSome: (test) => `case ${sequenceNodeText(ctx, test)}:\n`,
    onNone: () => 'default:\n',
  })

const labeledStatementText = (ctx: PrintContext, node: LabeledStatement): string =>
  `${node.label.name}: ${statementText(ctx, node.body)}`

const tryStatementText = (ctx: PrintContext, node: TryStatement): string =>
  `try ${blockStatementText(ctx, node.block)}${catchClauseText(ctx, node.handler)}${finallyClauseText(ctx, node.finalizer)}`

const catchClauseText = (ctx: PrintContext, handler: CatchClause | null | undefined): string =>
  Option.match(Option.fromNullishOr(handler), {
    onSome: (value) => ` catch${catchParamText(ctx, value.param)} ${blockStatementText(ctx, value.body)}`,
    onNone: () => '',
  })

const catchParamText = (ctx: PrintContext, param: BindingPattern | null | undefined): string =>
  Option.match(Option.fromNullishOr(param), {
    onSome: (value) => ` (${catchParamBodyText(ctx, value)})`,
    onNone: () => '',
  })

const catchParamBodyText = (ctx: PrintContext, param: BindingPattern): string =>
  Match.value(param).pipe(
    Match.when(isNode('Identifier'), (n) => identifierWithOptionalText(n)),
    Match.orElse((n) => sequenceNodeText(ctx, n)),
  )

const finallyClauseText = (ctx: PrintContext, finalizer: BlockStatement | null | undefined): string =>
  Option.match(Option.fromNullishOr(finalizer), {
    onSome: (value) => ` finally ${blockStatementText(ctx, value)}`,
    onNone: () => '',
  })

const variableDeclarationText = (ctx: PrintContext, node: VariableDeclaration): string =>
  `${flagText(node.declare, 'declare ')}${node.kind} ${node.declarations
    .map((declaration) => variableDeclaratorText(ctx, declaration))
    .join(', ')}`

const variableDeclaratorText = (ctx: PrintContext, node: VariableDeclarator): string =>
  `${bindingTargetText(ctx, node.id)}${flagText(node.definite, '!')}${typeAnnotationText(
    ctx,
    bindingTypeAnnotation(node.id),
  )}${initializerText(ctx, node.init)}`

const bindingTargetText = (ctx: PrintContext, id: BindingPattern): string =>
  Match.value(id).pipe(
    Match.when(isNode('Identifier'), (n) => `${bindingNameText(n)}${flagText(n.optional, '?')}`),
    Match.orElse((n) => sequenceNodeText(ctx, n)),
  )

const identifierWithOptionalText = (ctx: PrintContext, node: BindingIdentifier): string =>
  `${bindingNameText(node)}${flagText(node.optional, '?')}${typeAnnotationText(ctx, node.typeAnnotation)}`

const paramText = (ctx: PrintContext, param: ParamPattern): string =>
  Match.value(param).pipe(
    Match.when(isNode('RestElement'), (n) => restParamText(ctx, n)),
    Match.when(isNode('TSParameterProperty'), (n) => parameterPropertyText(ctx, n)),
    Match.when(isNode('Identifier'), (n) => formalParameterText(ctx, n)),
    Match.when(isNode('ObjectPattern'), (n) => formalParameterText(ctx, n)),
    Match.when(isNode('ArrayPattern'), (n) => formalParameterText(ctx, n)),
    Match.when(isNode('AssignmentPattern'), (n) => formalParameterText(ctx, n)),
    Match.orElse(() => ''),
  )

const restParamText = (
  ctx: PrintContext,
  param: Extract<ParamPattern, { readonly type: 'RestElement' }>,
): string =>
  `...${assignmentNodeText(ctx, param.argument)}${typeAnnotationText(ctx, param.typeAnnotation)}`

const parameterPropertyText = (
  ctx: PrintContext,
  param: Extract<ParamPattern, { readonly type: 'TSParameterProperty' }>,
): string =>
  `${decoratorsText(ctx, param.decorators)}${parameterPropertyModifiers(param)}${parameterPropertyTargetText(
    ctx,
    param.parameter,
  )}`

const parameterPropertyTargetText = (ctx: PrintContext, parameter: BindingPattern): string =>
  Match.value(parameter).pipe(
    Match.when(isNode('Identifier'), (n) => identifierWithOptionalText(n)),
    Match.orElse((n) => sequenceNodeText(ctx, n)),
  )

const formalParameterText = (ctx: PrintContext, param: BindingPattern): string =>
  `${decoratorsText(ctx, param.decorators)}${formalParameterBodyText(ctx, param)}`

const formalParameterBodyText = (ctx: PrintContext, param: BindingPattern): string =>
  Match.value(param).pipe(
    Match.when(isNode('Identifier'), (n) => identifierWithOptionalText(n),
    ),
    Match.orElse(
      (n) => `${assignmentNodeText(ctx, n)}${typeAnnotationText(ctx, bindingTypeAnnotation(n))}`,
    ),
  )

const classBodyText = (ctx: PrintContext, node: ClassBody): string =>
  Boolean.match(node.body.length === 0, {
    onTrue: () => '{}',
    onFalse: () =>
      `{\n${indentedBodyText(
        ctx,
        node.body,
        (inner, element) => printNodePrec(inner, element, PREC.Sequence),
      )}${indent(ctx)}}`,
  })

const indentedBodyText = <T>(
  ctx: PrintContext,
  items: readonly T[],
  print: (ctx: PrintContext, item: T) => string,
): string => {
  const inner: PrintContext = { indentLevel: ctx.indentLevel + 1 }
  return items.map((item) => `${indent(inner)}${print(inner, item)}\n`).join('')
}

const methodDefinitionText = (ctx: PrintContext, node: MethodDefinition): string =>
  `${decoratorsText(ctx, node.decorators)}${methodDefinitionPrefix(node, node.value)}${propertyKeyText(
    ctx,
    node.key,
    node.computed === true,
    PREC.Sequence,
  )}${flagText(node.optional, '?')}${functionTailText(ctx, node.value)}`

const propertyDefinitionText = (ctx: PrintContext, node: PropertyDefinition): string =>
  `${decoratorsText(ctx, node.decorators)}${propertyDefinitionModifiers(node)}${propertyKeyText(
    ctx,
    node.key,
    node.computed === true,
    PREC.Sequence,
  )}${flagText(node.optional, '?')}${flagText(node.definite, '!')}${typeAnnotationText(
    ctx,
    node.typeAnnotation,
  )}${initializerText(ctx, node.value)};`

const accessorPropertyText = (ctx: PrintContext, node: AccessorProperty): string =>
  `${decoratorsText(ctx, node.decorators)}${flagText(node.accessibility, `${node.accessibility} `)}${flagText(
    node.static,
    'static ',
  )}${flagText(node.override, 'override ')}accessor ${propertyKeyText(
    ctx,
    node.key,
    node.computed === true,
    PREC.Sequence,
  )}${flagText(node.definite, '!')}${typeAnnotationText(ctx, node.typeAnnotation)}${initializerText(
    ctx,
    node.value,
  )};`

const initializerText = (ctx: PrintContext, value: Node | null | undefined): string =>
  flagText(value, ` = ${assignmentNodeText(ctx, value)}`)

const staticBlockText = (ctx: PrintContext, node: StaticBlock): string => {
  const inner: PrintContext = { indentLevel: ctx.indentLevel + 1 }
  return `static {\n${node.body
    .map((stmt) => `${indent(inner)}${statementText(inner, stmt)}\n`)
    .join('')}${indent(ctx)}}`
}

const importDeclarationText = (ctx: PrintContext, node: ImportDeclaration): string => {
  const source = importSourceText(node.source, node.attributes)
  return `import ${importKindText(node)}${importClauseText(node, source)};`
}

const importClauseText = (node: ImportDeclaration, source: string): string =>
  Boolean.match(node.specifiers.length === 0, {
    onTrue: () => source,
    onFalse: () => `${importBindingsText(node.specifiers)} from ${source}`,
  })

const importSourceText = (source: StringLiteral, attrs: readonly ImportAttribute[]): string =>
  `${source.raw ?? JSON.stringify(source.value)}${importAttributesText(attrs)}`

const exportNamedDeclarationText = (ctx: PrintContext, node: ExportNamedDeclaration): string =>
  Option.match(Option.fromNullishOr(node.declaration), {
    onSome: (declaration) => `export ${statementText(ctx, declaration)}`,
    onNone: () =>
      `export ${flagText(node.exportKind === 'type', 'type ')}{ ${node.specifiers
        .map((specifier) => exportSpecifierText(specifier))
        .join(', ')} }${exportSourceClauseText(node)};`,
  })

const exportSourceClauseText = (node: ExportNamedDeclaration): string =>
  Option.match(Option.fromNullishOr(node.source), {
    onSome: (source) => ` from ${JSON.stringify(source.value)}${importAttributesText(node.attributes)}`,
    onNone: () => '',
  })

const exportDefaultDeclarationText = (ctx: PrintContext, node: ExportDefaultDeclaration): string =>
  `export default ${Match.value(node.declaration).pipe(
    Match.when(isBareDefaultExport, (declaration) => statementText(ctx, declaration)),
    Match.orElse((declaration) => `${printNodePrec(ctx, declaration, PREC.Assignment)};`),
  )}`

const exportAllDeclarationText = (ctx: PrintContext, node: ExportAllDeclaration): string =>
  `export ${flagText(node.exportKind === 'type', 'type ')}*${exportedNameClauseText(node.exported)} from ${JSON.stringify(node.source.value)}${importAttributesText(node.attributes)};`

const tsTypeAliasDeclarationText = (ctx: PrintContext, node: TSTypeAliasDeclaration): string =>
  `${flagText(node.declare, 'declare ')}type ${node.id.name}${typeParametersText(ctx, node.typeParameters)} = ${printTSTypeToString(ctx, node.typeAnnotation)};`

const tsInterfaceDeclarationText = (ctx: PrintContext, node: TSInterfaceDeclaration): string =>
  `${flagText(node.declare, 'declare ')}interface ${node.id.name}${typeParametersText(
    ctx,
    node.typeParameters,
  )}${interfaceExtendsText(ctx, node.extends)} ${tsInterfaceBodyText(ctx, node.body)}`

const interfaceExtendsText = (ctx: PrintContext, extensions: TSInterfaceDeclaration['extends']): string => {
  const rendered = extensions.map((heritage) => heritageText(ctx, heritage)).join(', ')
  return flagText(rendered, ` extends ${rendered}`)
}

const tsInterfaceBodyText = (ctx: PrintContext, node: TSInterfaceBody): string =>
  Boolean.match(node.body.length === 0, {
    onTrue: () => '{}',
    onFalse: () => `{\n${indentedBodyText(ctx, node.body, printTSSignatureText)}${indent(ctx)}}`,
  })

const printTSSignatureText = (ctx: PrintContext, sig: TSInterfaceBody['body'][number]): string =>
  Match.value(sig).pipe(
    Match.when(isNode('TSPropertySignature'), (n) => printTSPropertySignatureText(ctx, n)),
    Match.when(isNode('TSIndexSignature'), (n) => printTSIndexSignatureText(ctx, n)),
    Match.when(isNode('TSCallSignatureDeclaration'), (n) => printTSCallSignatureText(ctx, n)),
    Match.when(isNode('TSConstructSignatureDeclaration'), (n) => printTSConstructSignatureText(ctx, n)),
    Match.when(isNode('TSMethodSignature'), (n) => printTSMethodSignatureText(ctx, n)),
    Match.orElse(() => ''),
  )

const printTSPropertySignatureText = (ctx: PrintContext, node: TSPropertySignature): string =>
  `${flagText(node.readonly, 'readonly ')}${propertyKeyText(ctx, node.key, node.computed === true, PREC.Sequence)}${flagText(node.optional, '?')}${typeAnnotationText(ctx, node.typeAnnotation)};`

const printTSIndexSignatureText = (ctx: PrintContext, node: TSIndexSignature): string => {
  const parameters = node.parameters.map((parameter) => indexParameterText(ctx, parameter)).join(', ')
  return `${flagText(node.readonly, 'readonly ')}${flagText(node.static, 'static ')}[${parameters}]${typeAnnotationText(ctx, node.typeAnnotation)};`
}

const indexParameterText = (ctx: PrintContext, parameter: TSIndexSignature['parameters'][number]): string =>
  `${parameter.name}: ${printTSTypeToString(ctx, parameter.typeAnnotation.typeAnnotation)}`

const printTSCallSignatureText = (ctx: PrintContext, node: TSCallSignatureDeclaration): string =>
  `${typeParametersText(ctx, node.typeParameters)}(${paramsText(ctx, node.params)})${typeAnnotationText(ctx, node.returnType)};`

const printTSConstructSignatureText = (ctx: PrintContext, node: TSConstructSignatureDeclaration): string =>
  `new ${typeParametersText(ctx, node.typeParameters)}(${paramsText(ctx, node.params)})${typeAnnotationText(ctx, node.returnType)};`

const printTSMethodSignatureText = (ctx: PrintContext, node: TSMethodSignature): string =>
  `${methodKindText(node.kind)}${propertyKeyText(ctx, node.key, node.computed === true, PREC.Sequence)}${flagText(node.optional, '?')}${typeParametersText(ctx, node.typeParameters)}(${paramsText(ctx, node.params)})${typeAnnotationText(ctx, node.returnType)};`

const tsEnumDeclarationText = (ctx: PrintContext, node: TSEnumDeclaration): string =>
  `${flagText(node.declare, 'declare ')}${flagText(node.const, 'const ')}enum ${node.id.name} {\n${indentedBodyText(
    ctx,
    node.body.members,
    printEnumMemberText,
  )}${indent(ctx)}}`

const printEnumMemberText = (ctx: PrintContext, member: TSEnumDeclaration['body']['members'][number]): string =>
  `${identifierOrLiteralNameText(ctx, member.id)}${initializerText(ctx, member.initializer)},`

const identifierOrLiteralNameText = (ctx: PrintContext, id: Node): string =>
  Match.value(id).pipe(
    Match.when(isNode('Identifier'), (n) => identifierNameText(n)),
    Match.when(isNode('Literal'), (n) => literalText(n)),
    Match.orElse((n) => sequenceNodeText(ctx, n)),
  )

const tsModuleDeclarationText = (ctx: PrintContext, node: Extract<Node, { type: 'TSModuleDeclaration' }>): string =>
  `${flagText(node.declare, 'declare ')}${moduleHeaderText(ctx, node)}${moduleBodyText(ctx, node)}`

const moduleHeaderText = (ctx: PrintContext, node: Extract<Node, { type: 'TSModuleDeclaration' }>): string =>
  Boolean.match(node.global === true, {
    onTrue: () => 'global ',
    onFalse: () => `${node.kind} ${identifierOrLiteralNameText(ctx, node.id)}`,
  })

const moduleBodyText = (ctx: PrintContext, node: Extract<Node, { type: 'TSModuleDeclaration' }>): string =>
  Option.match(Option.fromNullishOr(node.body), {
    onSome: (body) => ` ${tsModuleBlockText(ctx, body)}`,
    onNone: () => ';',
  })

const tsModuleBlockText = (ctx: PrintContext, node: Extract<Node, { type: 'TSModuleBlock' }>): string =>
  `{\n${indentedBodyText(ctx, node.body, statementText)}${indent(ctx)}}`

const tsImportEqualsDeclarationText = (ctx: PrintContext, node: TSImportEqualsDeclaration): string =>
  `import ${flagText(node.importKind === 'type', 'type ')}${node.id.name} = ${moduleReferenceText(ctx, node.moduleReference)};`

const moduleReferenceText = (
  ctx: PrintContext,
  reference: TSImportEqualsDeclaration['moduleReference'],
): string =>
  Match.value(reference).pipe(
    Match.when(isNode('TSExternalModuleReference'), (n) => `require(${externalModuleArgumentText(n.expression.value)})`,
    ),
    Match.orElse((n) => sequenceNodeText(ctx, n)),
  )

const printTSTypeToString = (ctx: PrintContext, node: TSType): string =>
  Match.value(node).pipe(
    Match.when(isNode('TSAnyKeyword'), () => 'any'),
    Match.when(isNode('TSStringKeyword'), () => 'string'),
    Match.when(isNode('TSBooleanKeyword'), () => 'boolean'),
    Match.when(isNode('TSNumberKeyword'), () => 'number'),
    Match.when(isNode('TSBigIntKeyword'), () => 'bigint'),
    Match.when(isNode('TSSymbolKeyword'), () => 'symbol'),
    Match.when(isNode('TSVoidKeyword'), () => 'void'),
    Match.when(isNode('TSUndefinedKeyword'), () => 'undefined'),
    Match.when(isNode('TSNullKeyword'), () => 'null'),
    Match.when(isNode('TSNeverKeyword'), () => 'never'),
    Match.when(isNode('TSUnknownKeyword'), () => 'unknown'),
    Match.when(isNode('TSObjectKeyword'), () => 'object'),
    Match.when(isNode('TSIntrinsicKeyword'), () => 'intrinsic'),
    Match.when(isNode('TSThisType'), () => 'this'),
    Match.when(isNode('TSTypeReference'), (n) => `${printTSTypeName(ctx, n.typeName)}${typeArgumentsText(ctx, n.typeArguments)}`,
    ),
    Match.when(isNode('TSUnionType'), (n) => tsTypeListText(ctx, n.types, ' | ')),
    Match.when(isNode('TSIntersectionType'), (n) => tsTypeListText(ctx, n.types, ' & ')),
    Match.when(isNode('TSArrayType'), (n) => `${arrayElementTypeText(ctx, n.elementType)}[]`),
    Match.when(isNode('TSTypeLiteral'), (n) => printTSTypeLiteral(ctx, n.members)),
    Match.when(isNode('TSTupleType'), (n) => printTupleType(ctx, n.elementTypes)),
    Match.when(isNode('TSConditionalType'), (n) =>
        `${printTSTypeToString(ctx, n.checkType)} extends ${printTSTypeToString(ctx, n.extendsType)} ? ${printTSTypeToString(ctx, n.trueType)} : ${printTSTypeToString(ctx, n.falseType)}`,
    ),
    Match.when(isNode('TSInferType'), (n) => `infer ${n.typeParameter.name.name}${printTypeClause(ctx, ' extends ', n.typeParameter.constraint)}`,
    ),
    Match.when(isNode('TSTypeQuery'), (n) => `typeof ${printTypeQueryName(ctx, n)}${typeArgumentsText(ctx, n.typeArguments)}`,
    ),
    Match.when(isNode('TSImportType'), (n) => printTSImportType(ctx, n)),
    Match.when(isNode('TSTypeOperator'), (n) => `${n.operator} ${printTSTypeToString(ctx, n.typeAnnotation)}`,
    ),
    Match.when(isNode('TSMappedType'), (n) => printMappedType(ctx, n)),
    Match.when(isNode('TSTemplateLiteralType'), (n) => printTSTemplateLiteral(ctx, n)),
    Match.when(isNode('TSFunctionType'), (n) =>
        `${typeParametersText(ctx, n.typeParameters)}(${paramsText(ctx, n.params)}) => ${printTSTypeToString(ctx, n.returnType.typeAnnotation)}`,
    ),
    Match.when(isNode('TSConstructorType'), (n) =>
        `${flagText(n.abstract, 'abstract ')}new ${typeParametersText(ctx, n.typeParameters)}(${paramsText(ctx, n.params)}) => ${printTSTypeToString(ctx, n.returnType.typeAnnotation)}`,
    ),
    Match.when(isNode('TSTypePredicate'), (n) => printTSTypePredicate(ctx, n)),
    Match.when(isNode('TSIndexedAccessType'), (n) => `${printTSTypeToString(ctx, n.objectType)}[${printTSTypeToString(ctx, n.indexType)}]`,
    ),
    Match.when(isNode('TSNamedTupleMember'), (n) => printNamedTupleMember(ctx, n)),
    Match.when(isNode('TSLiteralType'), (n) => printTSLiteralType(ctx, n.literal)),
    Match.when(isNode('TSParenthesizedType'), (n) => `(${printTSTypeToString(ctx, n.typeAnnotation)})`,
    ),
    Match.when(isNode('TSJSDocNullableType'), (n) => printJSDocPostfixModifier(ctx, n, '?')),
    Match.when(isNode('TSJSDocNonNullableType'), (n) => printJSDocPostfixModifier(ctx, n, '!')),
    Match.when(isNode('TSJSDocUnknownType'), () => '?'),
    Match.orElse(() => ''),
  )

const tsTypeListText = (ctx: PrintContext, types: readonly TSType[], separator: string): string =>
  types.map((type) => printTSTypeToString(ctx, type)).join(separator)

const arrayElementTypeText = (ctx: PrintContext, type: TSType): string =>
  parenthesizedIf(
    ARRAY_ELEMENT_WRAPPED_KINDS[type.type] === true,
    printTSTypeToString(ctx, type),
  )

const printTSTypeLiteral = (ctx: PrintContext, members: readonly TSInterfaceBody['body'][number][]): string =>
  Boolean.match(members.length === 0, {
    onTrue: () => '{}',
    onFalse: () => `{ ${members.map((member) => signatureText(ctx, member)).join('; ')} }`,
  })

const signatureText = (ctx: PrintContext, member: TSInterfaceBody['body'][number]): string => {
  const printed = printTSSignatureText(ctx, member)
  return Boolean.match(printed.endsWith(';'), {
    onTrue: () => printed.slice(0, -1),
    onFalse: () => printed,
  })
}

const printTupleType = (ctx: PrintContext, elements: TSTupleType['elementTypes']): string =>
  `[${elements.map((element) => printTupleElement(ctx, element)).join(', ')}]`

const printTupleElement = (ctx: PrintContext, element: TSTupleType['elementTypes'][number]): string =>
  Match.value(element).pipe(
    Match.when(isNode('TSRestType'), (n) => `...${printTSTypeToString(ctx, n.typeAnnotation)}`),
    Match.when(isNode('TSOptionalType'), (n) => `${printTSTypeToString(ctx, n.typeAnnotation)}?`),
    Match.when(isNode('TSNamedTupleMember'), (n) => printNamedTupleMember(ctx, n)),
    Match.when(isTSType, (n) => printTSTypeToString(ctx, n)),
    Match.orElse(() => ''),
  )

const printNamedTupleMember = (ctx: PrintContext, member: TSNamedTupleMember): string =>
  `${member.label.name}${flagText(member.optional, '?')}: ${printTupleElement(ctx, member.elementType)}`

const printTypeClause = (ctx: PrintContext, keyword: string, type: TSType | null | undefined): string =>
  Option.match(Option.fromNullishOr(type), {
    onSome: (value) => `${keyword}${printTSTypeToString(ctx, value)}`,
    onNone: () => '',
  })

const printTypeQueryName = (ctx: PrintContext, node: TSTypeQuery): string =>
  Match.value(node.exprName).pipe(
    Match.when(isNode('TSImportType'), (n) => printTSTypeToString(ctx, n)),
    Match.orElse((n) => printTSTypeName(ctx, n)),
  )

const printTSTypeName = (ctx: PrintContext, name: TSTypeReference['typeName']): string =>
  Match.value(name).pipe(
    Match.when(isNode('TSQualifiedName'), (n) => `${printTSTypeName(ctx, n.left)}.${n.right.name}`),
    Match.when(isNode('Identifier'), (n) => n.name),
    Match.when(isNode('ThisExpression'), () => 'this'),
    Match.orElse((n) => sequenceNodeText(ctx, n)),
  )

const printTSImportTypeQualifier = (ctx: PrintContext, qualifier: TSImportType['qualifier']): string =>
  Option.match(Option.fromNullishOr(qualifier), {
    onSome: (value) => printTSImportTypeQualifierNode(ctx, value),
    onNone: () => '',
  })

const printTSImportTypeQualifierNode = (
  ctx: PrintContext,
  qualifier: NonNullable<TSImportType['qualifier']>,
): string =>
  Match.value(qualifier).pipe(
    Match.when(isNode('Identifier'), (n) => n.name),
    Match.orElse(
      (n) => `${printTSImportTypeQualifier(ctx, n.left)}.${n.right.name}`,
    ),
  )

const printTSImportType = (ctx: PrintContext, node: TSImportType): string =>
  `import(${JSON.stringify(node.source.value)}${flagText(
    node.options,
    `, ${assignmentNodeText(ctx, node.options)}`,
  )})${Option.match(Option.fromNullishOr(node.qualifier), {
    onSome: (qualifier) => `.${printTSImportTypeQualifierNode(ctx, qualifier)}`,
    onNone: () => '',
  })}${typeArgumentsText(ctx, node.typeArguments)}`

const printMappedType = (ctx: PrintContext, node: TSMappedType): string =>
  `{ ${printMappedTypeModifier(node.readonly, 'readonly ')}[${node.key.name} in ${printTSTypeToString(
    ctx,
    node.constraint,
  )}${printTypeClause(ctx, ' as ', node.nameType)}]${printMappedTypeModifier(node.optional, '?')}${printTypeClause(ctx, ': ', node.typeAnnotation)} }`

const printMappedTypeModifier = <A = unknown>(modifier: A, rendered: string): string =>
  Match.value(modifier).pipe(
    Match.when(true, () => rendered),
    Match.when('+', () => `+${rendered}`),
    Match.when('-', () => `-${rendered}`),
    Match.orElse(() => ''),
  )

const printTSTemplateLiteral = (ctx: PrintContext, node: TSTemplateLiteralType): string => {
  const tail = Arr.last(node.quasis)
  const segments = Arr.zipWith(
    Arr.dropRight(node.quasis, 1),
    node.types,
    (quasi, type) => `${quasi.value.raw}\${${printTSTypeToString(ctx, type)}}`,
  )
  return `\`${Arr.join(segments, '')}${Option.match(tail, {
    onSome: (quasi) => quasi.value.raw,
    onNone: () => '',
  })}\``
}

const printTSTypePredicate = (ctx: PrintContext, node: TSTypePredicate): string =>
  `${flagText(node.asserts, 'asserts ')}${typePredicateParameterText(node.parameterName)}${printPredicateAnnotation(ctx, node)}`

const printPredicateAnnotation = (ctx: PrintContext, node: TSTypePredicate): string =>
  Option.match(Option.fromNullishOr(node.typeAnnotation), {
    onSome: (annotation) => printTypeClause(ctx, ' is ', annotation.typeAnnotation),
    onNone: () => '',
  })

const printTSLiteralType = (ctx: PrintContext, literal: TSLiteralType['literal']): string =>
  Match.value(literal).pipe(
    Match.when(isNode('Literal'), (n) => literalText(n)),
    Match.when(isNode('TemplateLiteral'), (n) => templateLiteralText(ctx, n)),
    Match.when(isNode('UnaryExpression'), (n) =>
        `${n.operator}${Match.value(n.argument).pipe(
          Match.when(isNode('Literal'), (argument) => literalText(argument)),
          Match.orElse(() => ''),
        )}`,
    ),
    Match.orElse(() => ''),
  )

const printJSDocPostfixModifier = (
  ctx: PrintContext,
  node: JSDocNullableType | JSDocNonNullableType,
  marker: string,
): string =>
  Boolean.match(node.postfix, {
    onTrue: () => `${printTSTypeToString(ctx, node.typeAnnotation)}${marker}`,
    onFalse: () => `${marker}${printTSTypeToString(ctx, node.typeAnnotation)}`,
  })

const printTSTypeAnnotation = (ctx: PrintContext, node: TSTypeAnnotation): string =>
  `: ${printTSTypeToString(ctx, node.typeAnnotation)}`

const printTSTypeParameterDeclaration = (ctx: PrintContext, node: TSTypeParameterDeclaration): string =>
  `<${node.params.map((param) => printTSTypeParameter(ctx, param)).join(', ')}>`

const printTSTypeParameterInstantiation = (ctx: PrintContext, node: TSTypeParameterInstantiation): string =>
  `<${node.params.map((param) => printTSTypeToString(ctx, param)).join(', ')}>`

const printTSTypeParameter = (ctx: PrintContext, node: TSTypeParameterDeclaration['params'][number]): string =>
  `${typeParameterModifiersText(node)}${node.name.name}${printTypeClause(ctx, ' extends ', node.constraint)}${printTypeClause(ctx, ' = ', node.default)}`

const TS_TYPE_NODE_KINDS: Readonly<Record<string, true>> = {
  TSAnyKeyword: true,
  TSStringKeyword: true,
  TSBooleanKeyword: true,
  TSNumberKeyword: true,
  TSBigIntKeyword: true,
  TSSymbolKeyword: true,
  TSVoidKeyword: true,
  TSUndefinedKeyword: true,
  TSNullKeyword: true,
  TSNeverKeyword: true,
  TSUnknownKeyword: true,
  TSObjectKeyword: true,
  TSIntrinsicKeyword: true,
  TSThisType: true,
  TSTypeReference: true,
  TSUnionType: true,
  TSIntersectionType: true,
  TSArrayType: true,
  TSTypeLiteral: true,
  TSTupleType: true,
  TSNamedTupleMember: true,
  TSOptionalType: true,
  TSRestType: true,
  TSConditionalType: true,
  TSInferType: true,
  TSTypeQuery: true,
  TSImportType: true,
  TSTypeOperator: true,
  TSMappedType: true,
  TSTemplateLiteralType: true,
  TSFunctionType: true,
  TSConstructorType: true,
  TSTypePredicate: true,
  TSIndexedAccessType: true,
  TSLiteralType: true,
  TSParenthesizedType: true,
  TSJSDocNullableType: true,
  TSJSDocNonNullableType: true,
  TSJSDocUnknownType: true,
}

const isTSType = (node: Node): node is TSType => TS_TYPE_NODE_KINDS[node.type] === true

const FUNCTION_KINDS: Readonly<Record<string, true>> = {
  FunctionDeclaration: true,
  FunctionExpression: true,
  TSDeclareFunction: true,
  TSEmptyBodyFunctionExpression: true,
}

const isFunctionNode = (node: Node): node is FunctionNode => FUNCTION_KINDS[node.type] === true

const isAssignmentPattern = (node: Node): node is AssignmentPattern => node.type === 'AssignmentPattern'

const isIdentifierNode = (node: Node | null | undefined): node is Extract<Node, { type: 'Identifier' }> =>
  node?.type === 'Identifier'

const identifierName = (node: Node | null | undefined): string | undefined =>
  Option.getOrUndefined(Option.map(Option.filter(Option.fromNullishOr(node), isIdentifierNode), (n) => n.name))

const identifierNameText = (node: Node | null | undefined): string => identifierName(node) ?? ''

const privateIdentifierText = (node: Node | null | undefined): string =>
  Match.value(node).pipe(
    Match.when(isNode('PrivateIdentifier'), (n) => `#${n.name}`),
    Match.orElse(() => ''),
  )

const precOf = (node: Node): number =>
  Match.value(node).pipe(
    Match.when(isNode('SequenceExpression'), () => PREC.Sequence),
    Match.when(isNode('AssignmentExpression'), () => PREC.Assignment),
    Match.when(isNode('ConditionalExpression'), () => PREC.Conditional),
    Match.when(isNode('LogicalExpression'), (n) => logicalPrec(n.operator),
    ),
    Match.when(isNode('BinaryExpression'), (n) => binaryPrec(n.operator),
    ),
    Match.when(isNode('UnaryExpression'), () => PREC.Unary),
    Match.when(isNode('AwaitExpression'), () => PREC.Unary),
    Match.when(isNode('YieldExpression'), () => PREC.Unary),
    Match.when(isNode('UpdateExpression'), () => PREC.Update),
    Match.when(isNode('CallExpression'), () => PREC.Call),
    Match.when(isNode('NewExpression'), () => PREC.Call),
    Match.when(isNode('TaggedTemplateExpression'), () => PREC.Call),
    Match.when(isNode('ImportExpression'), () => PREC.Call),
    Match.when(isNode('MemberExpression'), () => PREC.Member),
    Match.when(isNode('ChainExpression'), () => PREC.Member),
    Match.orElse(() => PREC.Primary),
  )

const MEMBER_OBJECT_WRAPPED_KINDS: Readonly<Record<string, true>> = {
  SequenceExpression: true,
  AssignmentExpression: true,
  ConditionalExpression: true,
  LogicalExpression: true,
  BinaryExpression: true,
  UnaryExpression: true,
  UpdateExpression: true,
  AwaitExpression: true,
  YieldExpression: true,
}

const CALLEE_WRAPPED_KINDS: Readonly<Record<string, true>> = {
  SequenceExpression: true,
  ConditionalExpression: true,
}

const UNARY_OPERAND_WRAPPED_KINDS: Readonly<Record<string, true>> = {
  BinaryExpression: true,
  LogicalExpression: true,
  ConditionalExpression: true,
  SequenceExpression: true,
}

const UNARY_WORD_OPERATORS: Readonly<Record<string, true>> = {
  typeof: true,
  void: true,
  delete: true,
}

const ARRAY_ELEMENT_WRAPPED_KINDS: Readonly<Record<string, true>> = {
  TSUnionType: true,
  TSIntersectionType: true,
}

const jsxAttributeNameText = (name: JSXAttribute['name']): string =>
  Match.value(name).pipe(
    Match.when(isNode('JSXIdentifier'), (n) => n.name),
    Match.orElse((n) => `${n.namespace.name}:${n.name.name}`),
  )

interface PropertyLike {
  readonly type: 'Property'
  readonly kind?: string
  readonly method?: boolean
  readonly shorthand?: boolean
  readonly computed: boolean
  readonly key: Node
  readonly value: Node
}

const propertyFormOf = (fields: PropertyLike): PropertyForm =>
  Match.value(fields).pipe(
    Match.when(isAccessorKind, () => 'accessor'),
    Match.when(isMethodKind, () => 'method'),
    Match.when(isShorthandMatch, () => 'shorthand'),
    Match.when(isShorthandDefaultMatch, () => 'shorthandDefault'),
    Match.orElse(() => 'verbose'),
  )

const isAccessorKind = (fields: PropertyLike): boolean => fields.kind === 'get' || fields.kind === 'set'

const isMethodKind = (fields: PropertyLike): boolean => fields.method === true

const isShorthandMatch = (fields: PropertyLike): boolean =>
  fields.shorthand === true && namesMatch(identifierName(fields.key), identifierName(fields.value))

const isShorthandDefaultMatch = (fields: PropertyLike): boolean =>
  fields.shorthand === true && namesMatch(identifierName(fields.key), defaultTargetName(fields.value))

const defaultTargetName = (node: Node | null | undefined): string | undefined =>
  Option.getOrUndefined(
    Option.map(Option.filter(Option.some(node), isAssignmentPattern), (value) => identifierName(value.left)),
  )

const namesMatch = (key: string | undefined, value: string | undefined): boolean =>
  Option.match(Option.fromUndefinedOr(value), {
    onNone: () => false,
    onSome: (nonNull) => key === nonNull,
  })

const BINDING_TYPE_ANNOTATION_KINDS: Readonly<Record<string, true>> = {
  Identifier: true,
  ObjectPattern: true,
  ArrayPattern: true,
}

const bindingTypeAnnotation = (node: Node): TSTypeAnnotation | null | undefined =>
  Option.getOrUndefined(
    Option.filter(Option.some(node), isBindingTypeAnnotationCarrier).pipe(
      Option.map((carrier) => carrier.typeAnnotation),
    ),
  )

const isBindingTypeAnnotationCarrier = (
  node: Node,
): node is Extract<Node, { type: 'Identifier' | 'ObjectPattern' | 'ArrayPattern' }> =>
  BINDING_TYPE_ANNOTATION_KINDS[node.type] === true

const bindingNameText = (node: { readonly name?: string }): string => node.name ?? ''

interface ExportNameNode {
  readonly type: string
  readonly name?: string
  readonly value?: string
}

const EXPORT_NAME_TEXTS: Readonly<Record<string, (name: ExportNameNode) => string>> = {
  Identifier: (name) => name.name ?? '',
  Literal: (name) => name.value ?? '',
}

const exportNameToString = (name: ExportNameNode): string =>
  (EXPORT_NAME_TEXTS[name.type] ?? ((exported: ExportNameNode) => exported.value ?? ''))(name)

const importKindText = (node: ImportDeclaration): string => flagText(node.importKind === 'type', 'type ')

interface ImportBinding {
  readonly type: string
  readonly local: { readonly name: string }
  readonly imported?: { readonly type: string; readonly name?: string; readonly value?: string }
  readonly importKind?: string
}

const importBindingsText = (specifiers: readonly ImportBinding[]): string =>
  [
    defaultSpecifierText(specifiers),
    namespaceSpecifierText(specifiers),
    namedSpecifiersText(specifiers),
  ]
    .filter((text) => text.length > 0)
    .join(', ')

const defaultSpecifierText = (specifiers: readonly ImportBinding[]): string =>
  importLocalName(specifiers.find((specifier) => specifier.type === 'ImportDefaultSpecifier'))

const namespaceSpecifierText = (specifiers: readonly ImportBinding[]): string => {
  const name = importLocalName(specifiers.find((specifier) => specifier.type === 'ImportNamespaceSpecifier'))
  return flagText(name, `* as ${name}`)
}

const namedSpecifiersText = (specifiers: readonly ImportBinding[]): string => {
  const rendered = specifiers
    .filter((specifier) => specifier.type === 'ImportSpecifier')
    .map((specifier) => namedSpecifierText(specifier))
    .join(', ')
  return flagText(rendered, `{ ${rendered} }`)
}

const namedSpecifierText = (specifier: ImportBinding): string =>
  `${flagText(specifier.importKind === 'type', 'type ')}${exportAliasText(
    importedNameText(specifier.imported),
    specifier.local.name,
  )}`

const importLocalName = (specifier: ImportBinding | undefined): string =>
  Option.match(Option.fromUndefinedOr(specifier), {
    onSome: (value) => value.local.name,
    onNone: () => '',
  })

const importedNameText = (imported: ImportBinding['imported']): string =>
  Option.match(Option.fromUndefinedOr(imported), {
    onSome: (value) => importedNameOf(value),
    onNone: () => '',
  })

const importedNameOf = (imported: NonNullable<ImportBinding['imported']>): string =>
  Match.value(imported.type).pipe(
    Match.when('Identifier', () => imported.name ?? ''),
    Match.orElse(() => imported.value ?? ''),
  )

const exportAliasText = (localName: string, exportedName: string): string =>
  Boolean.match(localName === exportedName, {
    onTrue: () => localName,
    onFalse: () => `${localName} as ${exportedName}`,
  })

const exportSpecifierText = (specifier: {
  readonly local: ExportNameNode
  readonly exported: ExportNameNode
  readonly exportKind?: string
}): string =>
  `${flagText(specifier.exportKind === 'type', 'type ')}${exportAliasText(
    exportNameToString(specifier.local),
    exportNameToString(specifier.exported),
  )}`

const exportedNameClauseText = (exported: ExportNameNode | null | undefined): string =>
  Option.match(Option.fromNullishOr(exported), {
    onSome: (value) => ` as ${exportNameToString(value)}`,
    onNone: () => '',
  })

const importAttributesText = (attrs: readonly ImportAttribute[]): string => {
  const rendered = attrs.map((attribute) => importAttributeText(attribute)).join(', ')
  return flagText(rendered, ` with { ${rendered} }`)
}

const importAttributeText = (attribute: ImportAttribute): string =>
  `${importAttrKeyText(attribute.key)}: ${JSON.stringify(attribute.value.value)}`

const importAttrKeyText = (key: ImportAttribute['key']): string =>
  Match.value(key).pipe(
    Match.when(isNode('Identifier'), (n) => n.name),
    Match.orElse((n) => JSON.stringify(n.value)),
  )

const bareArrowParamName = (node: ArrowFunctionExpression): string => {
  const name = singleParamName(node)
  return flagText(name.length > 0 && node.returnType == null, name)
}

const singleParamName = (node: ArrowFunctionExpression): string =>
  Match.value(node.params.length).pipe(
    Match.when(1, () => bareParameterName(Arr.head(node.params))),
    Match.orElse(() => ''),
  )

const bareParameterName = (param: Option.Option<ParamPattern>): string =>
  Option.match(param, {
    onSome: (value) => bareParameterNameOf(value),
    onNone: () => '',
  })

const isUnannotatedIdentifier = (
  param: ParamPattern,
): param is Extract<ParamPattern, { readonly type: 'Identifier' }> =>
  param.type === 'Identifier' && param.typeAnnotation == null

const bareParameterNameOf = (param: ParamPattern): string =>
  Option.getOrElse(
    Option.map(Option.filter(Option.some(param), isUnannotatedIdentifier), (n) => n.name),
    () => '',
  )

const functionHeaderText = (node: FunctionNode): string =>
  `${flagText(node.declare, 'declare ')}${flagText(node.async, 'async ')}function${flagText(
    node.generator,
    '*',
  )}${namedDeclarationText(node)}`

const namedDeclarationText = (node: { readonly id?: { readonly name: string } | null }): string =>
  Option.match(Option.fromNullishOr(node.id), {
    onSome: (id) => ` ${id.name}`,
    onNone: () => '',
  })

const parameterPropertyModifiers = (
  param: Extract<ParamPattern, { readonly type: 'TSParameterProperty' }>,
): string =>
  `${flagText(param.accessibility, `${param.accessibility} `)}${flagText(param.readonly, 'readonly ')}${flagText(
    param.override,
    'override ',
  )}${flagText(param.static, 'static ')}`

const commentText = (comment: AttachedComment): string =>
  Match.value(comment.type).pipe(
    Match.when('Block', () => `/*${comment.value}*/`),
    Match.orElse(() => `//${comment.value}`),
  )

const methodDefinitionPrefix = (node: MethodDefinition, fn: FunctionNode): string =>
  `${flagText(node.accessibility, `${node.accessibility} `)}${flagText(node.static, 'static ')}${flagText(
    node.override,
    'override ',
  )}${flagText(fn.async, 'async ')}${flagText(fn.generator, '*')}${methodKindText(node.kind)}`

const methodKindText = (kind: string): string =>
  Match.value(kind).pipe(
    Match.when('get', () => 'get '),
    Match.when('set', () => 'set '),
    Match.orElse(() => ''),
  )

const propertyDefinitionModifiers = (node: PropertyDefinition): string =>
  `${flagText(node.declare, 'declare ')}${flagText(node.accessibility, `${node.accessibility} `)}${flagText(
    node.static,
    'static ',
  )}${flagText(node.readonly, 'readonly ')}${flagText(node.override, 'override ')}`

type LiteralSource<A = unknown> = {
  readonly value: A
  readonly raw: string | null
  readonly bigint?: string
  readonly regex?: { readonly pattern: string; readonly flags: string }
}

const BARE_DEFAULT_EXPORT_KINDS: Readonly<Record<string, true>> = {
  FunctionDeclaration: true,
  ClassDeclaration: true,
  TSInterfaceDeclaration: true,
}

const isBareDefaultExport = (
  node: ExportDefaultDeclaration['declaration'],
): node is FunctionNode | Class | TSInterfaceDeclaration =>
  BARE_DEFAULT_EXPORT_KINDS[node.type] === true

const typeParameterModifiersText = (node: TSTypeParameterDeclaration['params'][number]): string =>
  `${flagText(node.in, 'in ')}${flagText(node.out, 'out ')}${flagText(node.const, 'const ')}`

const typePredicateParameterText = (parameterName: TSTypePredicate['parameterName']): string =>
  Match.value(parameterName).pipe(
    Match.when(isNode('TSThisType'), () => 'this'),
    Match.orElse((n) => n.name),
  )

const externalModuleArgumentText = (value: string): string =>
  Boolean.match(Boolean(value), {
    onTrue: () => JSON.stringify(value),
    onFalse: () => '""',
  })

interface AttachedComment {
  readonly type: string
  readonly value: string
}

interface CommentHost {
  readonly type: string
  readonly leadingComments?: readonly AttachedComment[]
  readonly trailingComments?: readonly AttachedComment[]
}

if (import.meta.vitest !== void 0) {
  const { it } = await import('@effect/vitest')
  const { Schema } = await import('effect')
  const Arbitrary = await import('effect/unstable/arbitrary/Arbitrary')
  const oxc = await import('oxc-parser')
  const legacy = await import('./legacy.tmp.js')

  const TEMPLATE_TYPE_FRAGMENTS = Schema.Literals([
    'export type T1 = `v${string}`;',
    'export type T2 = `x${T1 | string}y${number}`;',
    'export type T3 = `a${T2}${T1}b`;',
    'export interface W1 { readonly f: `p${T3}` }',
    'export type T4 = ``;',
    'export type T5 = `${T1}`;',
    'export type T6 = `mix ${T4 | `inner ${T1}`}`;',
    'export const once = (x: string) => x;',
  ])

  const snippet = Arbitrary.map(
    Arbitrary.schema(Schema.Array(TEMPLATE_TYPE_FRAGMENTS)),
    (fragments) => fragments.join('\n'),
  )

  it.prop('∀src_TemplateTypePrint_≡Legacy', [snippet], ([source]) => {
    const parsed = oxc.parseSync('law.ts', source, { lang: 'ts', range: true })
    const printed = printProgram(parsed.program, { comments: parsed.comments, hashbang: null })
    return printed === legacy.printProgram(parsed.program, { comments: parsed.comments, hashbang: null })
  })
}
