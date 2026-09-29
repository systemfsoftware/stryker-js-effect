import type { TestRunner } from '@systemfsoftware/stryker-js-plugin-interface'
import { describe, it } from '@systemfsoftware/vitest'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import {
  detectDryRunFlakes,
  DetectDryRunFlakesCommand,
  type DryRunFlakeDecision,
  DryRunFlakesDetected,
} from '../detect-dry-run-flakes.workflow.js'
import { type DryRunPass } from '../dry-run-coverage.schema.js'

type FlakeResult = Result.Result<DryRunFlakeDecision, never>

const statusesOf = (pass: DryRunPass): Map<string, TestRunner.TestStatus> =>
  new Map(pass.tests.map((test) => [test.id, test.status] as const))

const coveredSetsOf = (pass: DryRunPass): Map<string, ReadonlySet<string>> =>
  new Map(
    Object.entries(pass.mutantCoverage?.perTest ?? {}).map(([testId, coverage]) =>
      [
        testId,
        new Set(Object.entries(coverage).filter(([, hits]) => hits > 0).map(([mutantId]) => mutantId)),
      ] as const
    ),
  )

const testIdsAcross = (first: DryRunPass, second: DryRunPass): readonly string[] =>
  [...new Set([...first.tests.map((test) => test.id), ...second.tests.map((test) => test.id)])].sort()

const atIndex = (values: readonly string[], index: number): string | undefined =>
  values.length === 0 ? undefined : values[Math.abs(index) % values.length]

const statusDiffers = (first: DryRunPass, second: DryRunPass, testId: string): boolean =>
  statusesOf(first).get(testId) !== statusesOf(second).get(testId)

const coverageDiffers = (first: DryRunPass, second: DryRunPass, testId: string): boolean => {
  const left = coveredSetsOf(first).get(testId)
  const right = coveredSetsOf(second).get(testId)
  const leftValues = left === undefined ? [] : [...left]
  const rightValues = right === undefined ? [] : [...right]
  return leftValues.length !== rightValues.length || leftValues.some((value) => right?.has(value) !== true)
}

const coveredByTest = (
  pass: DryRunPass,
  testId: string,
): readonly string[] => [...(coveredSetsOf(pass).get(testId) ?? [])]

const flakyIdsOf = (result: FlakeResult): readonly string[] =>
  Result.isSuccess(result) && S.is(DryRunFlakesDetected)(result.success) ? result.success.flakyTestIds : []

const flakyMutantIdsOf = (result: FlakeResult): readonly string[] =>
  Result.isSuccess(result) && S.is(DryRunFlakesDetected)(result.success) ? result.success.flakyMutantIds : []

const doubled = (command: DetectDryRunFlakesCommand): DetectDryRunFlakesCommand =>
  DetectDryRunFlakesCommand.make({ first: command.first, second: command.first })

describe('detectDryRunFlakes', () => {
  it.prop(
    '∀ci_DetectDryRunFlakesCommandAndIndex_≡AChosenTestIsFlakyExactlyWhenItsStatusOrCoverageDiffers',
    { of: [DetectDryRunFlakesCommand, S.Int], subject: detectDryRunFlakes },
    (subject, [command, index]) => {
      const testId = atIndex(testIdsAcross(command.first, command.second), index)
      if (testId === undefined) {
        return true
      }
      const flaky = flakyIdsOf(subject(command)).includes(testId)
      const differs = statusDiffers(command.first, command.second, testId) ||
        coverageDiffers(command.first, command.second, testId)
      return flaky === differs
    },
  )

  it.prop(
    '∀cii_DetectDryRunFlakesCommandAndIndices_≡AFlakyTestsCoveredMutantsAreRefused',
    { of: [DetectDryRunFlakesCommand, S.Int, S.Int], subject: detectDryRunFlakes },
    (subject, [command, testIndex, mutantIndex]) => {
      const result = subject(command)
      const testId = atIndex(testIdsAcross(command.first, command.second), testIndex)
      if (testId === undefined || !flakyIdsOf(result).includes(testId)) {
        return true
      }
      const mutantId = atIndex(
        [...new Set([...coveredByTest(command.first, testId), ...coveredByTest(command.second, testId)])].sort(),
        mutantIndex,
      )
      return mutantId === undefined || flakyMutantIdsOf(result).includes(mutantId)
    },
  )

  it.prop(
    '∀c_DetectDryRunFlakesCommand_≡OnePassTwiceHasNoFlakes',
    { of: [DetectDryRunFlakesCommand], subject: detectDryRunFlakes },
    (subject, [command]) => {
      const result = subject(doubled(command))
      return Result.isSuccess(result) && S.is(DryRunFlakesDetected)(result.success) === false
    },
  )
})
