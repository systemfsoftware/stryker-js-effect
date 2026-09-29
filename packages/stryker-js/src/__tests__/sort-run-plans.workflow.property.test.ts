import { describe, it } from '@systemfsoftware/vitest'
import * as Result from 'effect/Result'

import { SortRunPlans, sortRunPlans } from '../sort-run-plans.workflow.js'

type Plan = (typeof SortRunPlans)['Encoded']['plans'][number]

const reloadRank = (plan: Plan): number => Number(plan.reloadEnvironment)

const referenceCompare = (left: Plan, right: Plan): number => {
  if (reloadRank(left) !== reloadRank(right)) {
    return reloadRank(left) - reloadRank(right)
  }
  if (left.netTime !== right.netTime) {
    return right.netTime - left.netTime
  }
  if (left.id < right.id) {
    return -1
  }
  return Number(left.id > right.id)
}

const keyOf = (plan: Plan): string => `${plan.id}|${plan.netTime}|${plan.reloadEnvironment}`

const isOrdered = (plans: readonly Plan[]): boolean =>
  plans.every((plan, index) => {
    const previous = plans[index - 1]
    return previous === undefined || referenceCompare(previous, plan) <= 0
  })

const keepsReloadPlansLast = (plans: readonly Plan[]): boolean => {
  const firstReload = plans.findIndex((plan) => plan.reloadEnvironment)
  return firstReload === -1 || plans.slice(firstReload).every((plan) => plan.reloadEnvironment)
}

describe('sortRunPlans', () => {
  it.prop(
    '∀p_Plans_≡CostliestFirstThenByIdWithStaticAndReloadLast',
    { of: [SortRunPlans], subject: sortRunPlans },
    (subject, [command]) => {
      const result = subject(command)
      if (Result.isFailure(result)) {
        return false
      }
      const sorted = result.success
      return (
        sorted.length === command.plans.length &&
        isOrdered(sorted) &&
        keepsReloadPlansLast(sorted) &&
        JSON.stringify(sorted.map(keyOf).sort()) === JSON.stringify(command.plans.map(keyOf).sort())
      )
    },
  )
})
