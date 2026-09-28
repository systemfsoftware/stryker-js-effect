import { RunEvent } from '@systemfsoftware/stryker-js-cli-contract'
import { Report, TestRunner } from '@systemfsoftware/stryker-js-plugin-interface'
import { describe, it } from '@systemfsoftware/vitest'
import * as S from 'effect/Schema'

import { mutantCostOf, testBodyMsOf } from '../mutant-cost.js'

const addsUpToTheWallTime = (cost: RunEvent.MutantCost, elapsedMs: number): boolean =>
  Math.abs(cost.fixedOverheadMs + cost.testBodyMs - elapsedMs) <= Number.EPSILON * 4 * elapsedMs

describe('mutantCostOf', () => {
  it.prop(
    '∀r_MutantRunResult_≡TheCostPartsAddUpToTheWallTime',
    {
      of: [TestRunner.MutantRunResultSchema, Report.NonNegativeFinite, Report.NonNegativeInt],
      subject: mutantCostOf,
    },
    (subject, [result, elapsedMs, testsExecuted]) => {
      const testBodyMs = testBodyMsOf(result)
      const cost = subject({ elapsedMs, testBodyMs, testsExecuted, shared: false })
      const scorable = result.status === 'killed' || result.status === 'survived'
      const measuredTestTime = testBodyMs <= 0 || elapsedMs <= 0 || cost.testBodyMs > 0
      return addsUpToTheWallTime(cost, elapsedMs) &&
        cost.fixedOverheadMs >= 0 &&
        cost.testBodyMs >= 0 &&
        cost.testBodyMs <= elapsedMs &&
        (scorable || cost.testBodyMs === 0) &&
        measuredTestTime &&
        S.is(RunEvent.MutantCost)(cost)
    },
  )
})
