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

const isNode = <T extends string>(type: T) => <N extends { readonly type: string }>(
  node: N,
): node is Extract<N, { readonly type: T }> => node.type === type

type TSRenderer<K extends TSType['type']> = (
  ctx: PrintContext,
  node: Extract<TSType, { readonly type: K }>,
) => string

const printTSType = (ctx: PrintContext, node: TSTen): string => TS_TEXT[node.type](ctx, node)

const TS_TEXT: { readonly [K in TSTen['type']]: TSRenderer<K> } = {
  TSAnyKeyword: () => 'any',
  TSStringKeyword: () => 'string',
  TSUnionType: (ctx, n) => n.types.map((t) => printTSType(ctx, t)).join(' | '),
  TSIntersectionType: (ctx, n) => n.types.map((t) => printTSType(ctx, t)).join(' & '),
  TSArrayType: (ctx, n) => `${printTSType(ctx, n.elementType)}[]`,
  TSConditionalType: (ctx, n) => `${printTSType(ctx, n.checkType)} extends ${printTSType(ctx, n.extendsType)} ? ${printTSType(ctx, n.trueType)} : ${printTSType(ctx, n.falseType)}`,
  TSIndexedAccessType: (ctx, n) => `${printTSType(ctx, n.objectType)}[${printTSType(ctx, n.indexType)}]`,
  TSTypeOperator: (ctx, n) => `${n.operator} ${printTSType(ctx, n.typeAnnotation)}`,
  TSParenthesizedType: (ctx, n) => `(${printTSType(ctx, n.typeAnnotation)})`,
  TSTypeReference: () => 'ref',
}

export const precOfA = (node: Node): number =>
  Match.value(node).pipe(
    Match.when(isNode('SequenceExpression'), (n) => PREC.Sequence),
    Match.when(isNode('AssignmentExpression'), (n) => PREC.Assignment),
    Match.when(isNode('ConditionalExpression'), (n) => PREC.Conditional),
    Match.when(isNode('LogicalExpression'), (n) => logicalPrec(n.operator)),
    Match.when(isNode('BinaryExpression'), (n) => binaryPrec(n.operator)),
    Match.when(isNode('UnaryExpression'), (n) => PREC.Unary),
    Match.when(isNode('AwaitExpression'), (n) => PREC.Unary),
    Match.when(isNode('YieldExpression'), (n) => PREC.Unary),
    Match.when(isNode('UpdateExpression'), (n) => PREC.Update),
    Match.when(isNode('CallExpression'), (n) => PREC.Call),
    Match.when(isNode('NewExpression'), (n) => PREC.Call),
    Match.when(isNode('TaggedTemplateExpression'), (n) => PREC.Call),
    Match.when(isNode('ImportExpression'), (n) => PREC.Call),
    Match.when(isNode('MemberExpression'), (n) => PREC.Member),
    Match.when(isNode('ChainExpression'), (n) => PREC.Member),
    Match.orElse(() => PREC.Primary),
  )

export const threeSitesA = (ctx: PrintContext, x: TSTen, y: TSTen, z: TSTen): string =>
  [printTSType(ctx, x), printTSType(ctx, y), printTSType(ctx, z)].join(',')

export const privateTextA = (node: Node | undefined): string =>
  Match.value(node).pipe(
    Match.when(isNode('PrivateIdentifier'), (n) => `#${n.name}`),
    Match.orElse(() => ''),
  )
