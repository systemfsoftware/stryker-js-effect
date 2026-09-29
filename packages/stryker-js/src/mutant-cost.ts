import type { Mutant, TestRunner } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Match from 'effect/Match'

export interface MutantCostInput {
  readonly elapsedMs: number
  readonly testBodyMs: number
  readonly testsExecuted: number
  readonly shared: boolean
}

const executedTestBodyMsOf = (executedTests: readonly TestRunner.ExecutedTest[]): number =>
  executedTests.reduce((total, test) => total + test.timeSpentMs, 0)

export const testBodyMsOf = (result: TestRunner.MutantRunResult): number =>
  Match.value(result).pipe(
    Match.when({ status: 'killed' }, (killed) => executedTestBodyMsOf(killed.executedTests)),
    Match.when({ status: 'survived' }, (survived) => executedTestBodyMsOf(survived.executedTests)),
    Match.orElse(() => 0),
  )

const bodyTimeWithinWall = (elapsedMs: number, testBodyMs: number): number => Math.min(testBodyMs, elapsedMs)

export const costTotalMsOf = (cost: Mutant.MutantCost | undefined): number | undefined =>
  cost === undefined ? undefined : cost.fixedOverheadMs + cost.testBodyMs

export const mutantCostOf = (input: MutantCostInput): Mutant.MutantCost => {
  const testBodyMs = bodyTimeWithinWall(input.elapsedMs, input.testBodyMs)
  return {
    fixedOverheadMs: input.elapsedMs - testBodyMs,
    testBodyMs,
    testsExecuted: input.testsExecuted,
    shared: input.shared,
  }
}
