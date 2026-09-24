import { describe, it } from '@effect/vitest'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import { dryRun, DryRunCommand, DryRunError, DryRunFailed, DryRunPassed } from '../dry-run.workflow.js'

describe('dryRun', () => {
  it.prop('∀c_Command_≡Decision', [DryRunCommand], ([command]) => {
    const result = dryRun(command)
    if (command.status === 'Error') {
      return (
        Result.isFailure(result) &&
        S.is(DryRunError)(result.failure) &&
        result.failure.stage === 'dryRun'
      )
    }
    if (command.status === 'Timeout') {
      return (
        Result.isFailure(result) &&
        S.is(DryRunError)(result.failure) &&
        result.failure.stage === 'dryRun'
      )
    }
    if (command.testCount === 0 && command.allowEmpty === false) {
      return (
        Result.isFailure(result) &&
        S.is(DryRunError)(result.failure) &&
        result.failure.stage === 'dryRunNoTests'
      )
    }
    if (command.failedTestCount > 0) {
      return (
        Result.isSuccess(result) &&
        S.is(DryRunFailed)(result.success) &&
        result.success.testCount === command.testCount &&
        result.success.failedTestCount === command.failedTestCount
      )
    }
    return (
      Result.isSuccess(result) &&
      S.is(DryRunPassed)(result.success) &&
      result.success.testCount === command.testCount
    )
  })
})
