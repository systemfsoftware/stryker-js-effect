import { describe, it } from '@effect/vitest'
import { Mutant } from '@systemfsoftware/stryker-js-instrumenter'
import * as Effect from 'effect/Effect'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import { Arbitrary } from 'effect/unstable/arbitrary'

import { decideHitBound, HIT_LIMIT_FACTOR, makeMutantTestPlanner, planMutantTests } from '../Mutants.js'
import type { PlanMutantTestsInput } from '../Mutants.js'

const location = { start: { line: 1, column: 0 }, end: { line: 1, column: 1 } }

const mutant = Mutant.make({
  id: 'covered',
  fileName: 'src/finite.ts',
  mutatorName: 'ArithmeticOperator',
  replacement: '0',
  location,
})

const uncovered = Mutant.make({
  id: 'uncovered',
  fileName: 'src/other.ts',
  mutatorName: 'ArithmeticOperator',
  replacement: '0',
  location,
})

const commandFor = (
  hits: Record<string, number>,
  tests: Record<string, readonly string[]>,
  staticCoverage: Record<string, number>,
  mutants: readonly Mutant[],
): PlanMutantTestsInput => ({
  mutants,
  timeOverheadMS: 0,
  timeSpentAllTests: 10,
  hitsByMutantId: hits,
  staticCoverage,
  testsByMutantId: tests,
  testTimeById: { t1: 10 },
  options: { disableBail: false, timeoutMS: 500, timeoutFactor: 1.5, ignoreStatic: false },
  sandboxFileByName: {},
})

describe('decideHitBound', () => {
  it.prop(
    '∀n_DefinedCount_=CountTimesFactor',
    [Arbitrary.schema(S.Int.check(S.isBetween({ minimum: 0, maximum: 10000 })))],
    ([count]) => {
      const bound = decideHitBound(count, true, true)
      return bound._tag === 'Bound' && bound.hitLimit === count * HIT_LIMIT_FACTOR
    },
  )

  it.prop(
    '∀_CoveredMissingCount_RefusesRunnablePlan',
    [Arbitrary.schema(S.Int.check(S.isBetween({ minimum: 1, maximum: 20 })))],
    ([_seed]) => {
      const command = commandFor({}, { covered: ['t1'] }, { covered: 1 }, [mutant])
      const decision = decideHitBound(undefined, true, true)
      const exit = Effect.runSync(Effect.result(makeMutantTestPlanner(command)))
      const refused = Result.isFailure(exit)
      const planned = planMutantTests(command)
      const unboundedRun = planned.plans.some((plan) => plan.plan === 'Run' && plan.runOptions.hitLimit === undefined)
      return decision._tag === 'MissingHitCount' && refused && !unboundedRun
    },
  )

  it.prop(
    '∀_Uncovered_IsNotRun',
    [Arbitrary.schema(S.Int.check(S.isBetween({ minimum: 1, maximum: 20 })))],
    ([_seed]) => {
      const command = commandFor({}, {}, { covered: 1 }, [uncovered])
      const decision = decideHitBound(undefined, false, true)
      const planned = planMutantTests(command)
      const ran = planned.plans.some((plan) => plan.plan === 'Run')
      return decision._tag === 'Uncovered' && !ran
    },
  )
})
