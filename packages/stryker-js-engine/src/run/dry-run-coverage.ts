import type { Incremental } from '@systemfsoftware/stryker-js-contracts'
import { Mutant, type TestRunner } from '@systemfsoftware/stryker-js-plugin-interface'
import * as MutableHashMap from 'effect/MutableHashMap'
import * as MutableHashSet from 'effect/MutableHashSet'
import * as Option from 'effect/Option'

export const testFileModulesFieldOf = (
  modules: Readonly<Record<string, readonly string[]>> | undefined,
): { readonly testFileModules?: Readonly<Record<string, readonly string[]>> } =>
  modules === undefined ? {} : { testFileModules: modules }

const testsByIdOf = (result: Readonly<TestRunner.CompleteDryRunResult>) =>
  MutableHashMap.fromIterable(result.tests.map((test) => [test.id, test] as const))

const coveredMutantIdsOf = (coverage: Mutant.CoverageData) =>
  Object.entries(coverage).filter(([, count]) => count > 0).map(([mutantId]) => mutantId)

const testsByMutantIdOf = (
  mutantCoverage: Mutant.Coverage,
  testsById: MutableHashMap.MutableHashMap<string, TestRunner.TestResult>,
) =>
  Object.entries(mutantCoverage.perTest).reduce(
    (testsByMutantId, [testId, coverage]) =>
      Option.match(MutableHashMap.get(testsById, testId), {
        onNone: () => testsByMutantId,
        onSome: (test) =>
          coveredMutantIdsOf(coverage).reduce(
            (acc, mutantId) =>
              MutableHashMap.set(
                acc,
                mutantId,
                MutableHashSet.add(
                  Option.getOrElse(MutableHashMap.get(acc, mutantId), () =>
                    MutableHashSet.empty<TestRunner.TestResult>()),
                  test,
                ),
              ),
            testsByMutantId,
          ),
      }),
    MutableHashMap.empty<string, MutableHashSet.MutableHashSet<TestRunner.TestResult>>(),
  )

const hitsByMutantIdOf = (mutantCoverage: Mutant.Coverage) =>
  [mutantCoverage.static, ...Object.values(mutantCoverage.perTest)].reduce(
    (hitsByMutantId, coverage) =>
      Object.entries(coverage).reduce(
        (acc, [mutantId, count]) =>
          MutableHashMap.set(
            acc,
            mutantId,
            Option.getOrElse(MutableHashMap.get(acc, mutantId), () => 0) + count,
          ),
        hitsByMutantId,
      ),
    MutableHashMap.empty<string, number>(),
  )

export interface TestCoverageInput {
  readonly result: Readonly<TestRunner.CompleteDryRunResult>
  readonly dryRunCoverage: Incremental.DryRunCoverage
}

export const testCoverageOf = ({ result, dryRunCoverage }: TestCoverageInput): Incremental.TestCoverage => {
  const testsById = testsByIdOf(result)
  const mutantCoverage = Option.fromNullishOr(result.mutantCoverage)
  return {
    testsByMutantId: Option.match(mutantCoverage, {
      onNone: () => MutableHashMap.empty<string, MutableHashSet.MutableHashSet<TestRunner.TestResult>>(),
      onSome: (coverage) => testsByMutantIdOf(coverage, testsById),
    }),
    testsById,
    staticCoverage: Option.match(mutantCoverage, {
      onNone: () => undefined,
      onSome: (coverage) => coverage.static,
    }),
    hitsByMutantId: Option.match(mutantCoverage, {
      onNone: () => MutableHashMap.empty<string, number>(),
      onSome: (coverage) => hitsByMutantIdOf(coverage),
    }),
    dryRunCoverage,
  }
}

export const reusedTestCoverage = (coverage: Incremental.DryRunCoverage): Incremental.TestCoverage =>
  testCoverageOf({
    result: {
      status: 'complete',
      tests: [...coverage.tests],
      globalTestInputs: [...coverage.globalTestInputs],
      ...testFileModulesFieldOf(coverage.testFileModules),
      ...(coverage.mutantCoverage === undefined ? {} : { mutantCoverage: coverage.mutantCoverage }),
    },
    dryRunCoverage: coverage,
  })
