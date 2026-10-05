import { RunEvent } from '@systemfsoftware/stryker-js-cli-contract'
import { Mutant } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Arr from 'effect/Array'

import { costTotalMsOf } from './mutant-cost.js'

const MILLIS_PER_SECOND = 1000

export interface BudgetInput {
  readonly results: readonly Mutant.RunMutantResult[]
  readonly concurrency: number
  readonly actualSeconds: number
  readonly planPredictedSeconds?: number | undefined
}

const costMsOf = (result: Mutant.RunMutantResult): number => costTotalMsOf(result.cost) ?? 0

const predictedSecondsOf = (results: readonly Mutant.RunMutantResult[], concurrency: number): number => {
  const lanes = concurrency > 0 ? concurrency : 1
  return Arr.reduce(results, 0, (total, result) => total + costMsOf(result)) / lanes / MILLIS_PER_SECOND
}

export const budgetOf = (input: BudgetInput): RunEvent.Budget => ({
  predictedSeconds: input.planPredictedSeconds ?? predictedSecondsOf(input.results, input.concurrency),
  actualSeconds: input.actualSeconds,
})
