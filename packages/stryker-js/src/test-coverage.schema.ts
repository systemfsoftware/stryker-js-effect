import type { CoverageData } from '@systemfsoftware/stryker-js-instrumenter'
import type { TestResult } from '@systemfsoftware/stryker-js-plugin-interface'
import * as MutableHashMap from 'effect/MutableHashMap'
import * as MutableHashSet from 'effect/MutableHashSet'

export interface TestCoverage {
  readonly testsByMutantId: MutableHashMap.MutableHashMap<string, MutableHashSet.MutableHashSet<TestResult>>
  readonly testsById: MutableHashMap.MutableHashMap<string, TestResult>
  readonly staticCoverage: CoverageData | undefined
  readonly hitsByMutantId: MutableHashMap.MutableHashMap<string, number>
}
