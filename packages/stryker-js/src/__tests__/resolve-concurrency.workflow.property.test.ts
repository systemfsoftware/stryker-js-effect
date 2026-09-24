import { describe, it } from '@effect/vitest'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import {
  ResolveConcurrency,
  resolveConcurrency,
  TestRunnersAndCheckers,
  TestRunnersOnly,
} from '../resolve-concurrency.workflow.js'

const PERCENTAGE = /^(100|[1-9]?[0-9])%$/

const isPercentageText = (concurrency: number | string | undefined): concurrency is string =>
  typeof concurrency === 'string' && PERCENTAGE.test(concurrency)

const expectedTotal = (concurrency: number | string | undefined, availableParallelism: number): number => {
  if (isPercentageText(concurrency)) {
    const percentage = Number.parseInt(concurrency.slice(0, -1), 10)
    return Math.max(1, Math.round((availableParallelism * percentage) / 100))
  }
  if (typeof concurrency === 'number') {
    return concurrency
  }
  return availableParallelism > 4 ? availableParallelism - 1 : availableParallelism
}

describe('resolveConcurrency', () => {
  it.prop('∀c_Command_≡R4Split', [ResolveConcurrency], ([command]) => {
    const result = resolveConcurrency(command)
    if (Result.isFailure(result)) {
      return false
    }
    const total = expectedTotal(command.concurrency, command.availableParallelism)
    if (command.checkerCount === 0) {
      return (
        S.is(TestRunnersOnly)(result.success) &&
        result.success.total === total &&
        result.success.testRunners === total &&
        result.success.isPercentage === isPercentageText(command.concurrency)
      )
    }
    return (
      S.is(TestRunnersAndCheckers)(result.success) &&
      result.success.total === total &&
      result.success.checkers === Math.max(Math.ceil(total / 2), 1) &&
      result.success.testRunners === Math.max(Math.floor(total / 2), 1) &&
      result.success.isPercentage === isPercentageText(command.concurrency)
    )
  })
})
