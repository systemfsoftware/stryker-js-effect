import { Workflow } from '@systemfsoftware/effect-cell-types'
import * as Match from 'effect/Match'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import { type LocatedDirective, LocatedDirectiveSchema } from './directive.schema.js'

export type MutantRule = readonly LocatedDirective[]

export class FoldRuleCommand extends S.TaggedClass<FoldRuleCommand>()('FoldRuleCommand', {
  rule: S.Array(LocatedDirectiveSchema),
  directive: LocatedDirectiveSchema,
}) {}

const RuleFoldTypeId: unique symbol = Symbol.for('@systemfsoftware/stryker-js-instrumenter/RuleFold')
type RuleFoldTypeId = typeof RuleFoldTypeId

export class DisableFolded extends S.TaggedClass<DisableFolded>()('DisableFolded', {
  rule: S.Array(LocatedDirectiveSchema),
}) {
  readonly [RuleFoldTypeId] = RuleFoldTypeId
}

export class RestoreFolded extends S.TaggedClass<RestoreFolded>()('RestoreFolded', {
  rule: S.Array(LocatedDirectiveSchema),
}) {
  readonly [RuleFoldTypeId] = RuleFoldTypeId
}

export type FoldedRule = DisableFolded | RestoreFolded

export const foldRule = Workflow.total(
  FoldRuleCommand,
  (command: FoldRuleCommand): Result.Result<FoldedRule, never> =>
    Match.value(command.directive.directive.action).pipe(
      Match.when('restore', () => Result.succeed(RestoreFolded.make({ rule: [...command.rule, command.directive] }))),
      Match.when('disable', () => Result.succeed(DisableFolded.make({ rule: [...command.rule, command.directive] }))),
      Match.exhaustive,
    ),
)
