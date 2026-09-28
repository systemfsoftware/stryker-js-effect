import type { Mutant } from '@systemfsoftware/stryker-js-plugin-interface'
import type { TestRunner } from '@systemfsoftware/stryker-js-plugin-interface'
import type * as MutableHashMap from 'effect/MutableHashMap'
import type * as MutableHashSet from 'effect/MutableHashSet'

import type { DryRunCoverage } from './dry-run-coverage.schema.js'

export interface TestCoverage {
  readonly testsByMutantId: MutableHashMap.MutableHashMap<string, MutableHashSet.MutableHashSet<TestRunner.TestResult>>
  readonly testsById: MutableHashMap.MutableHashMap<string, TestRunner.TestResult>
  readonly staticCoverage: Mutant.CoverageData | undefined
  readonly hitsByMutantId: MutableHashMap.MutableHashMap<string, number>
  readonly dryRunCoverage?: DryRunCoverage | undefined
}
