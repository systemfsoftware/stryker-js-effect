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

const tsTypeTextOf = Match.type<TSType>().pipe(
  Match.discriminatorsExhaustive('type')({
    TSAnyKeyword: () => 'any',
    TSStringKeyword: () => 'string',
    TSUnionType: (n) => (ctx) => n.types.map((t) => printTSType(ctx, t)).join(' | '),
    TSIntersectionType: (n) => (ctx) => n.types.map((t) => printTSType(ctx, t)).join(' & '),
    TSArrayType: (n) => `${printTSType(ctx, n.elementType)}[]`,
    TSConditionalType: (n) => `${printTSType(ctx, n.checkType)} extends ${printTSType(ctx, n.extendsType)} ? ${printTSType(ctx, n.trueType)} : ${printTSType(ctx, n.falseType)}`,
    TSIndexedAccessType: (n) => `${printTSType(ctx, n.objectType)}[${printTSType(ctx, n.indexType)}]`,
    TSTypeOperator: (n) => `${n.operator} ${printTSType(ctx, n.typeAnnotation)}`,
    TSParenthesizedType: (n) => `(${printTSType(ctx, n.typeAnnotation)})`,
    TSTypeReference: () => 'ref',
  }),
)

const printTSType = (ctx: PrintContext, node: TSType): string => tsTypeTextOf(node)(ctx)

export const threeSites = (ctx: PrintContext, x: TSType, y: TSType, z: TSType): string =>
  [printTSType(ctx, x), printTSType(ctx, y), printTSType(ctx, z)].join(',')

const precOf = Match.type<Node>().pipe(
  Match.discriminators('type')({
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
  }),
  Match.orElse(() => PREC.Primary),
  Match.exhaustive,
)

export const usePrecOf = (node: Node): number => precOf(node)
