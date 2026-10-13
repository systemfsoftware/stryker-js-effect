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
  sources: S.String,
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
  planSources: S.String,
  sources: S.String,
}) {
  readonly [AdmitPlanHeadTypeId] = AdmitPlanHeadTypeId
  readonly exitClass = 'ConfigError' as const

  override get message(): string {
    return `the shard plan was scoped from ${this.planBase} with source digest ${this.planSources}, but the files it schedules now digest ${this.sources}; next: stryker plan --since ${this.planBase}`
  }
}

export type AdmitPlanHeadError = ShardPlanStale | ShardPlanWorktreeStale

const refusalOf = (command: AdmitPlanHeadCommand): Option.Option<AdmitPlanHeadError> =>
  Boolean.match(command.scope.head === command.head, {
    onTrue: () =>
      Boolean.match(command.scope.sources === command.sources, {
        onTrue: () => Option.none(),
        onFalse: () =>
          Option.some(
            ShardPlanWorktreeStale.make({
              planBase: command.scope.base,
              planSources: command.scope.sources,
              sources: command.sources,
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
