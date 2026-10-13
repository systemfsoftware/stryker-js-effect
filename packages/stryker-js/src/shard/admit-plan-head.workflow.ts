import { Workflow } from '@systemfsoftware/effect-cell-types'
import { ShardPlanDiffScoped, ShardPlanFullScope } from '@systemfsoftware/stryker-js-cli-contract'
import * as Boolean from 'effect/Boolean'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

const AdmitPlanHeadTypeId: unique symbol = Symbol.for('@systemfsoftware/stryker-js/AdmitPlanHead')
type AdmitPlanHeadTypeId = typeof AdmitPlanHeadTypeId

export class AdmitPlanHeadCommand extends S.Class<AdmitPlanHeadCommand>('AdmitPlanHeadCommand')({
  scope: S.Union([ShardPlanDiffScoped, ShardPlanFullScope]),
  head: S.NonEmptyString,
  worktree: S.String,
}) {
  static readonly [Workflow.InstrumentationBrand] = {} as const
}

export class PlanHeadCurrent extends S.TaggedClass<PlanHeadCurrent>()('PlanHeadCurrent', {
  head: S.String,
}) {
  readonly [AdmitPlanHeadTypeId] = AdmitPlanHeadTypeId
}

export class ShardPlanStale extends S.TaggedError<ShardPlanStale>()('ShardPlanStale', {
  planHead: S.String,
  head: S.String,
}) {
  readonly [AdmitPlanHeadTypeId] = AdmitPlanHeadTypeId
  readonly exitClass = 'ConfigError' as const

  override get message(): string {
    return `the shard plan was made at commit ${this.planHead}, but HEAD is ${this.head}; plan again at this commit`
  }
}

export class ShardPlanWorktreeStale extends S.TaggedError<ShardPlanWorktreeStale>()('ShardPlanWorktreeStale', {
  planBase: S.String,
  planWorktree: S.String,
  worktree: S.String,
}) {
  readonly [AdmitPlanHeadTypeId] = AdmitPlanHeadTypeId
  readonly exitClass = 'ConfigError' as const

  override get message(): string {
    return `the shard plan was scoped from ${this.planBase} with ${
      treeOf(this.planWorktree)
    }, but the working tree now holds ${treeOf(this.worktree)}; next: stryker plan --since ${this.planBase}`
  }
}

export type AdmitPlanHeadError = ShardPlanStale | ShardPlanWorktreeStale

const treeOf = (digest: string): string =>
  Option.match(Option.liftPredicate(digest, (value) => value.length > 0), {
    onNone: () => 'a clean tree',
    onSome: (value) => `the worktree ${value}`,
  })

const refusalOf = (command: AdmitPlanHeadCommand): Option.Option<AdmitPlanHeadError> =>
  Boolean.match(command.scope.head === command.head, {
    onTrue: () =>
      Boolean.match(command.scope.worktree === command.worktree, {
        onTrue: () => Option.none(),
        onFalse: () =>
          Option.some(
            ShardPlanWorktreeStale.make({
              planBase: command.scope.base,
              planWorktree: command.scope.worktree,
              worktree: command.worktree,
            }),
          ),
      }),
    onFalse: () => Option.some(ShardPlanStale.make({ planHead: command.scope.head, head: command.head })),
  })

export const admitPlanHead = Workflow.make({
  command: AdmitPlanHeadCommand,
  decision: PlanHeadCurrent,
  error: S.Union([ShardPlanStale, ShardPlanWorktreeStale]),
  decide: (command: AdmitPlanHeadCommand): Result.Result<PlanHeadCurrent, AdmitPlanHeadError> =>
    Option.match(refusalOf(command), {
      onNone: () => Result.succeed(PlanHeadCurrent.make({ head: command.head })),
      onSome: (refusal) => Result.fail(refusal),
    }),
})
