import { Workflow } from '@systemfsoftware/effect-cell-types'
import { Mutant, Report } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Arr from 'effect/Array'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

const RunOrderTypeId: unique symbol = Symbol.for('@systemfsoftware/stryker-js/RunOrder')
type RunOrderTypeId = typeof RunOrderTypeId

export class OrderedRunPlan extends S.TaggedClass<OrderedRunPlan>()('OrderedRunPlan', {
  id: Mutant.MutantId,
  netTime: Report.NonNegativeFinite,
  reloadEnvironment: S.Boolean,
}) {
  readonly [RunOrderTypeId] = RunOrderTypeId
}

export class SortRunPlans extends S.TaggedClass<SortRunPlans>()('SortRunPlans', {
  plans: S.Array(OrderedRunPlan),
}) {
  static readonly [Workflow.InstrumentationBrand] = {} as const
}

const { sign } = Math

const reloadRank = (plan: OrderedRunPlan): number => Number(plan.reloadEnvironment)

const idRank = (left: OrderedRunPlan, right: OrderedRunPlan): number =>
  sign(Number(left.id > right.id) - Number(left.id < right.id))

const comparePlans = (left: OrderedRunPlan, right: OrderedRunPlan): number =>
  Option.getOrElse(
    Arr.findFirst(
      [
        sign(reloadRank(left) - reloadRank(right)),
        sign(right.netTime - left.netTime),
        idRank(left, right),
      ],
      (rank) => rank !== 0,
    ),
    () => 0,
  )

const orderedOf = (plans: readonly OrderedRunPlan[]): readonly OrderedRunPlan[] =>
  [...plans].sort(comparePlans).map((plan) =>
    OrderedRunPlan.make({ id: plan.id, netTime: plan.netTime, reloadEnvironment: plan.reloadEnvironment })
  )

const decide = (command: SortRunPlans): Result.Result<readonly OrderedRunPlan[], never> =>
  Result.succeed(orderedOf(command.plans))

export const sortRunPlans = Workflow.make({
  command: SortRunPlans,
  decision: S.Array(OrderedRunPlan),
  error: S.Never,
  decide,
})
