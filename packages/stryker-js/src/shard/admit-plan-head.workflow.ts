import { Workflow } from '@systemfsoftware/effect-cell-types'
import { ShardPlanDiffScoped, ShardPlanFullScope } from '@systemfsoftware/stryker-js-cli-contract'
import * as Boolean from 'effect/Boolean'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

const AdmitPlanHeadTypeId: unique symbol = Symbol.for('@systemfsoftware/stryker-js/AdmitPlanHead')
type AdmitPlanHeadTypeId = typeof AdmitPlanHeadTypeId

export class AdmitPlanHeadCommand extends S.Class<AdmitPlanHeadCommand>('AdmitPlanHeadCommand')({
  scope: S.Union([ShardPlanDiffScoped, ShardPlanFullScope]),
  head: S.NonEmptyString,
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

export const admitPlanHead = Workflow.make({
  command: AdmitPlanHeadCommand,
  decision: PlanHeadCurrent,
  error: ShardPlanStale,
  decide: (command: AdmitPlanHeadCommand): Result.Result<PlanHeadCurrent, ShardPlanStale> =>
    Boolean.match(command.scope.head === command.head, {
      onTrue: () => Result.succeed(PlanHeadCurrent.make({ head: command.head })),
      onFalse: () => Result.fail(ShardPlanStale.make({ planHead: command.scope.head, head: command.head })),
    }),
})
