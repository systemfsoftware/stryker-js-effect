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

const matchTSB = (ctx: PrintContext, node: TSType): string =>
  Match.value(node).pipe(
    Match.discriminatorsExhaustive('type')({
      TSAnyKeyword: () => 'any',
      TSStringKeyword: () => 'string',
      TSUnionType: (n) => n.types.map((t) => matchTSB(ctx, t)).join(' | '),
      TSIntersectionType: (n) => n.types.map((t) => matchTSB(ctx, t)).join(' & '),
      TSArrayType: (n) => `${matchTSB(ctx, n.elementType)}[]`,
      TSConditionalType: (n) => `${matchTSB(ctx, n.checkType)} extends ${matchTSB(ctx, n.extendsType)} ? ${matchTSB(ctx, n.trueType)} : ${matchTSB(ctx, n.falseType)}`,
      TSIndexedAccessType: (n) => `${matchTSB(ctx, n.objectType)}[${matchTSB(ctx, n.indexType)}]`,
      TSTypeOperator: (n) => `${n.operator} ${matchTSB(ctx, n.typeAnnotation)}`,
      TSParenthesizedType: (n) => `(${matchTSB(ctx, n.typeAnnotation)})`,
      TSTypeReference: () => 'ref',
    }),
  )

export const precOfB = (node: Node): number =>
  Match.value(node).pipe(
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

export const threeSitesB = (ctx: PrintContext, x: TSType, y: TSType, z: TSType): string =>
  [matchTSB(ctx, x), matchTSB(ctx, y), matchTSB(ctx, z)].join(',')

export const privateTextB = (node: Node | undefined): string =>
  Match.value(node).pipe(
    Match.discriminators('type')({ PrivateIdentifier: (n) => `#${n.name}` }),
    Match.orElse(() => ''),
    Match.exhaustive,
  )
