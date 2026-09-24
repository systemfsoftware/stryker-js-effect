import * as Match from 'effect/Match'
import type { Node, TSType } from '@systemfsoftware/stryker-ignorer-interface'

interface PrintContext {
  readonly indentLevel: number
}

const PREC = {
  Sequence: 0,
  Assignment: 1,
  Conditional: 2,
  Unary: 3,
  Update: 4,
  Call: 5,
  Member: 6,
  Primary: 7,
} as const

const logicalPrec = (op: string): number => (op === '||' ? 1 : op === '&&' ? 2 : 3)
const binaryPrec = (op: string): number => (op === '+' ? 4 : op === '*' ? 5 : 6)

type TSTen = Extract<TSType, { readonly type: 'TSAnyKeyword' | 'TSStringKeyword' | 'TSUnionType' | 'TSIntersectionType' | 'TSArrayType' | 'TSConditionalType' | 'TSIndexedAccessType' | 'TSTypeOperator' | 'TSParenthesizedType' | 'TSTypeReference' }>
type N15 = Extract<Node, { readonly type: 'SequenceExpression' | 'AssignmentExpression' | 'ConditionalExpression' | 'LogicalExpression' | 'BinaryExpression' | 'UnaryExpression' | 'AwaitExpression' | 'YieldExpression' | 'UpdateExpression' | 'CallExpression' | 'NewExpression' | 'TaggedTemplateExpression' | 'ImportExpression' | 'MemberExpression' | 'ChainExpression' }>

type TSRenderer<K extends TSTen['type']> = (
  ctx: PrintContext,
  node: Extract<TSTen, { readonly type: K }>,
) => string

const TS_TEXT: { readonly [K in TSTen['type']]: TSRenderer<K> } = {
  TSAnyKeyword: () => 'any',
  TSStringKeyword: () => 'string',
  TSUnionType: (ctx, n) => n.types.map((t) => matchTSC(ctx, t)).join(' | '),
  TSIntersectionType: (ctx, n) => n.types.map((t) => matchTSC(ctx, t)).join(' & '),
  TSArrayType: (ctx, n) => `${matchTSC(ctx, n.elementType)}[]`,
  TSConditionalType: (ctx, n) => `${matchTSC(ctx, n.checkType)} extends ${matchTSC(ctx, n.extendsType)} ? ${matchTSC(ctx, n.trueType)} : ${matchTSC(ctx, n.falseType)}`,
  TSIndexedAccessType: (ctx, n) => `${matchTSC(ctx, n.objectType)}[${matchTSC(ctx, n.indexType)}]`,
  TSTypeOperator: (ctx, n) => `${n.operator} ${matchTSC(ctx, n.typeAnnotation)}`,
  TSParenthesizedType: (ctx, n) => `(${matchTSC(ctx, n.typeAnnotation)})`,
  TSTypeReference: () => 'ref',
}

const matchTSC = (ctx: PrintContext, node: TSType): string => TS_TEXT[node.type](ctx, node)

type PrecRenderer<K extends N15['type']> = (node: Extract<N15, { readonly type: K }>) => number

const NODE_TEXT: { readonly [K in N15['type']]: PrecRenderer<K> } = {
  SequenceExpression: () => PREC.Sequence,
  AssignmentExpression: () => PREC.Assignment,
  ConditionalExpression: () => PREC.Conditional,
  LogicalExpression: (n) => logicalPrec(n.operator),
  BinaryExpression: (n) => binaryPrec(n.operator),
  UnaryExpression: () => PREC.Unary,
  AwaitExpression: () => PREC.Unary,
  YieldExpression: () => PREC.Unary,
  UpdateExpression: () => PREC.Update,
  CallExpression: () => PREC.Call,
  NewExpression: () => PREC.Call,
  TaggedTemplateExpression: () => PREC.Call,
  ImportExpression: () => PREC.Call,
  MemberExpression: () => PREC.Member,
  ChainExpression: () => PREC.Member,
}

export const precOfC = (node: N15): number => NODE_TEXT[node.type](node)

export const threeSitesC = (ctx: PrintContext, x: TSTen, y: TSTen, z: TSTen): string =>
  [matchTSC(ctx, x), matchTSC(ctx, y), matchTSC(ctx, z)].join(',')

type PrivOnly = Extract<Node, { readonly type: 'PrivateIdentifier' }>
const PRIV_TEXT: {
  readonly [K in PrivOnly['type']]: (n: Extract<PrivOnly, { readonly type: K }>) => string
} = {
  PrivateIdentifier: (n) => `#${n.name}`,
}

export const privateTextC = (node: PrivOnly): string => PRIV_TEXT[node.type](node)
