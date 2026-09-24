import type { Mutant } from '@systemfsoftware/stryker-js-instrumenter'
import type { TestRunner } from '@systemfsoftware/stryker-js-plugin-interface'
import * as MutableHashMap from 'effect/MutableHashMap'
import * as MutableHashSet from 'effect/MutableHashSet'

export interface TestCoverage {
  readonly testsByMutantId: MutableHashMap.MutableHashMap<string, MutableHashSet.MutableHashSet<TestRunner.TestResult>>
  readonly testsById: MutableHashMap.MutableHashMap<string, TestRunner.TestResult>
  readonly staticCoverage: Mutant.CoverageData | undefined
  readonly hitsByMutantId: MutableHashMap.MutableHashMap<string, number>
}
