import { RunEvent } from '@systemfsoftware/stryker-js-cli-contract'
import { Mutant } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Arr from 'effect/Array'
import * as Boolean from 'effect/Boolean'

import { costOrZero, decidedWithoutATest } from './mutant-cost.js'

const MILLIS_PER_SECOND = 1000

export interface BudgetInput {
  readonly results: readonly Mutant.RunMutantResult[]
  readonly concurrency: number
  readonly actualSeconds: number
  readonly planPredictedSeconds?: number | undefined
}

const testWorkMsOf = (result: Mutant.RunMutantResult): number =>
  Boolean.match(decidedWithoutATest(result.status), {
    onTrue: () => 0,
    onFalse: () => costOrZero(result.cost),
  })

const predictedSecondsOf = (results: readonly Mutant.RunMutantResult[], concurrency: number): number => {
  const lanes = concurrency > 0 ? concurrency : 1
  return Arr.reduce(results, 0, (total, result) => total + testWorkMsOf(result)) / lanes / MILLIS_PER_SECOND
}

export const budgetOf = (input: BudgetInput): RunEvent.Budget => ({
  predictedSeconds: input.planPredictedSeconds ?? predictedSecondsOf(input.results, input.concurrency),
  actualSeconds: input.actualSeconds,
})

export interface FixedSecondsInput {
  readonly results: readonly Mutant.RunMutantResult[]
  readonly actualSeconds: number
  readonly freshDryRunMs: number
}

export const fixedSecondsOf = (input: FixedSecondsInput): number =>
  Math.max(
    0,
    input.actualSeconds -
      (input.freshDryRunMs + Arr.reduce(input.results, 0, (total, result) => total + costOrZero(result.cost))) /
        MILLIS_PER_SECOND,
  )
