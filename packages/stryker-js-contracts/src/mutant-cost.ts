import type { Mutant, TestRunner } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'

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

export const costOrZero = (cost: Mutant.MutantCost | undefined): number =>
  Option.getOrElse(Option.fromUndefinedOr(costTotalMsOf(cost)), () => 0)

const DECIDED_WITHOUT_A_TEST: Partial<Record<Mutant.MutantStatus, true>> = {
  CompileError: true,
  NoCoverage: true,
  Ignored: true,
}

export const decidedWithoutATest = (status: Mutant.MutantStatus): boolean => DECIDED_WITHOUT_A_TEST[status] === true

export const checkOnlyCostOf = (checkMs: number): Mutant.MutantCost => ({
  fixedOverheadMs: checkMs,
  testBodyMs: 0,
  testsExecuted: 0,
  shared: false,
})

export const mutantCostOf = (input: MutantCostInput): Mutant.MutantCost => {
  const testBodyMs = bodyTimeWithinWall(input.elapsedMs, input.testBodyMs)
  return {
    fixedOverheadMs: input.elapsedMs - testBodyMs,
    testBodyMs,
    testsExecuted: input.testsExecuted,
    shared: input.shared,
  }
}
