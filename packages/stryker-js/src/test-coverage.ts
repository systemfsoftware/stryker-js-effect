import type { CompleteDryRunResult } from '@systemfsoftware/stryker-js-plugin-interface'
import * as MutableHashMap from 'effect/MutableHashMap'
import * as MutableHashSet from 'effect/MutableHashSet'
import * as Option from 'effect/Option'

import type { TestCoverage } from './test-coverage.schema.js'

const testsByIdOf = (result: Readonly<CompleteDryRunResult>) => {
  const testsById = MutableHashMap.empty<string, TestCoverage['testsById'][string]>()
  for (const test of result.tests) {
    MutableHashMap.set(testsById, test.id, test)
  }
  return testsById
}

export const testCoverageOf = (
  result: Readonly<CompleteDryRunResult>,
): TestCoverage => {
  const testsById = testsByIdOf(result)
  const testsByMutantId = MutableHashMap.empty<string, MutableHashSet.MutableHashSet<TestCoverage['testsById'][string]>>()
  const hitsByMutantId = MutableHashMap.empty<string, number>()
  Option.match(Option.fromNullishOr(result.mutantCoverage), {
    onNone: () => undefined,
    onSome: (coverage) => {
      for (const [testId, counts] of Object.entries(coverage.perTest)) {
        Option.match(MutableHashMap.get(testsById, testId), {
          onNone: () => undefined,
          onSome: (test) => {
            for (const [mutantId, count] of Object.entries(counts)) {
              if (count > 0) {
                const existing = MutableHashMap.get(testsByMutantId, mutantId)
                const tests = Option.getOrElse(existing, () =>
                  MutableHashSet.empty<TestCoverage['testsById'][string]>())
                MutableHashSet.add(tests, test)
                if (Option.isNone(existing)) {
                  MutableHashMap.set(testsByMutantId, mutantId, tests)
                }
              }
            }
          },
        })
      }
      for (const counts of [coverage.static, ...Object.values(coverage.perTest)]) {
        for (const [mutantId, count] of Object.entries(counts)) {
          MutableHashMap.set(
            hitsByMutantId,
            mutantId,
            Option.getOrElse(MutableHashMap.get(hitsByMutantId, mutantId), () => 0) + count,
          )
        }
      }
    },
  })
  return { testsByMutantId, testsById, staticCoverage: result.mutantCoverage?.static, hitsByMutantId }
}
