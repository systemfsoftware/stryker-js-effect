import { Workflow } from '@systemfsoftware/effect-cell-types'
import * as Arr from 'effect/Array'
import * as Boolean from 'effect/Boolean'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import { SyntaxKind } from 'typescript/unstable/ast'

export const ContextSlot = S.Literals([
  'operand',
  'element',
  'member',
  'value',
  'name',
  'condition',
  'branch',
  'left',
  'right',
  'argument',
  'callee',
  'body',
  'initializer',
  'other',
])
export type ContextSlot = typeof ContextSlot.Type

export const LeftOperandMember = S.Literals([
  'any',
  'unknown',
  'nullish',
  'primitive',
  'falsy-literal',
  'truthy-literal',
  'always-truthy',
  'unrecognized',
])
export type LeftOperandMember = typeof LeftOperandMember.Type

export const ReturnTarget = S.Literals(['none', 'annotated', 'unannotated-expression', 'unannotated-declaration'])
export type ReturnTarget = typeof ReturnTarget.Type

export class ClassifyContextLinkCommand extends S.TaggedClass<ClassifyContextLinkCommand>()(
  'ClassifyContextLinkCommand',
  {
    parentKind: S.Enum(SyntaxKind),
    slot: ContextSlot,
    operator: S.Enum(SyntaxKind),
    constAssertion: S.Boolean,
    annotated: S.Boolean,
    returnTarget: ReturnTarget,
    leftOperand: S.Array(LeftOperandMember),
  },
) {
  static readonly [Workflow.InstrumentationBrand] = {} as const
}

const ContextLinkTypeId: unique symbol = Symbol.for('@systemfsoftware/stryker-js-typescript-checker/ContextLink')
type ContextLinkTypeId = typeof ContextLinkTypeId

export class LinkClimb extends S.TaggedClass<LinkClimb>()('LinkClimb', {}) {
  readonly [ContextLinkTypeId] = ContextLinkTypeId
}

export class LinkClimbFunction extends S.TaggedClass<LinkClimbFunction>()('LinkClimbFunction', {}) {
  readonly [ContextLinkTypeId] = ContextLinkTypeId
}

export class LinkDeclared extends S.TaggedClass<LinkDeclared>()('LinkDeclared', {}) {
  readonly [ContextLinkTypeId] = ContextLinkTypeId
}

export class LinkCallArgument extends S.TaggedClass<LinkCallArgument>()('LinkCallArgument', {}) {
  readonly [ContextLinkTypeId] = ContextLinkTypeId
}

export class LinkUnenforced extends S.TaggedClass<LinkUnenforced>()('LinkUnenforced', {}) {
  readonly [ContextLinkTypeId] = ContextLinkTypeId
}

export const ContextLink = S.Union([LinkClimb, LinkClimbFunction, LinkDeclared, LinkCallArgument, LinkUnenforced])
export type ContextLink = typeof ContextLink.Type

type LinkRule = (command: ClassifyContextLinkCommand) => ContextLink

const climb = (): ContextLink => LinkClimb.make({})
const climbFunction = (): ContextLink => LinkClimbFunction.make({})
const declared = (): ContextLink => LinkDeclared.make({})
const callArgument = (): ContextLink => LinkCallArgument.make({})
const unenforced = (): ContextLink => LinkUnenforced.make({})

const RIGHT_OPERAND_RULES: ReadonlyMap<SyntaxKind, LinkRule> = new Map([
  [SyntaxKind.EqualsToken, declared],
  [SyntaxKind.QuestionQuestionToken, reachingWhenLeftIs(['unknown', 'nullish'])],
  [SyntaxKind.BarBarToken, reachingWhenLeftIs(['unknown', 'nullish', 'primitive', 'falsy-literal'])],
  [
    SyntaxKind.AmpersandAmpersandToken,
    reachingWhenLeftIs(['unknown', 'primitive', 'truthy-literal', 'always-truthy']),
  ],
])

function reachingWhenLeftIs(reaching: ReadonlyArray<LeftOperandMember>): LinkRule {
  return (command) =>
    Boolean.match(Arr.some(command.leftOperand, (member) => Arr.contains(reaching, member)), {
      onTrue: climb,
      onFalse: unenforced,
    })
}

const rightOperandOf: LinkRule = (command) =>
  Option.match(Option.fromUndefinedOr(RIGHT_OPERAND_RULES.get(command.operator)), {
    onNone: unenforced,
    onSome: (rule) => rule(command),
  })

const returnedOf = (unannotatedExpression: () => ContextLink): LinkRule => (command) =>
  Match.value(command.returnTarget).pipe(
    Match.when('annotated', declared),
    Match.when('unannotated-expression', unannotatedExpression),
    Match.when('unannotated-declaration', unenforced),
    Match.when('none', unenforced),
    Match.exhaustive,
  )

const initializerOf: LinkRule = (command) => Boolean.match(command.annotated, { onTrue: declared, onFalse: unenforced })

const assertedOf: LinkRule = (command) => Boolean.match(command.constAssertion, { onTrue: climb, onFalse: unenforced })

const ALLOW_LIST: ReadonlyMap<SyntaxKind, Partial<Record<ContextSlot, LinkRule>>> = new Map([
  [SyntaxKind.ParenthesizedExpression, { operand: climb }],
  [SyntaxKind.ArrayLiteralExpression, { element: climb }],
  [SyntaxKind.ObjectLiteralExpression, { member: climb }],
  [SyntaxKind.PropertyAssignment, { value: climb }],
  [SyntaxKind.ConditionalExpression, { branch: climb }],
  [SyntaxKind.BinaryExpression, { right: rightOperandOf }],
  [SyntaxKind.AsExpression, { operand: assertedOf }],
  [SyntaxKind.SatisfiesExpression, { operand: declared }],
  [SyntaxKind.CallExpression, { argument: callArgument }],
  [SyntaxKind.NewExpression, { argument: callArgument }],
  [SyntaxKind.ArrowFunction, { body: returnedOf(climb) }],
  [SyntaxKind.ReturnStatement, { operand: returnedOf(climbFunction) }],
  [SyntaxKind.VariableDeclaration, { initializer: initializerOf }],
  [SyntaxKind.PropertyDeclaration, { initializer: initializerOf }],
  [SyntaxKind.Parameter, { initializer: initializerOf }],
])

const ruleOf = (command: ClassifyContextLinkCommand): Option.Option<LinkRule> =>
  Option.flatMap(
    Option.fromUndefinedOr(ALLOW_LIST.get(command.parentKind)),
    (rules) => Option.fromUndefinedOr(rules[command.slot]),
  )

const decide = (command: ClassifyContextLinkCommand): Result.Result<ContextLink, never> =>
  Result.succeed(Option.match(ruleOf(command), { onNone: unenforced, onSome: (rule) => rule(command) }))

export const classifyContextLink = Workflow.make({
  command: ClassifyContextLinkCommand,
  decision: ContextLink,
  error: S.Never,
  decide,
})
