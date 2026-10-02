import { describe, it } from '@systemfsoftware/vitest'
import * as Equal from 'effect/Equal'
import * as Predicate from 'effect/Predicate'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import { dryRun, DryRunCommand, DryRunFailed, DryRunPassed } from '../dry-run.workflow.js'
import { RunFailure } from '../Run.schema.js'

describe('dryRun', () => {
  it.prop(
    '∀c_Command_≡Decision',
    { of: [DryRunCommand], subject: dryRun },
    (subject, [command]) => {
      const result = subject(command)
      if (command.status === 'Error') {
        return (
          Result.isFailure(result) &&
          S.is(RunFailure)(result.failure) &&
          Predicate.isTagged(result.failure.evidence, 'BaselineErrored') &&
          result.failure.evidence.stage === 'dryRun'
        )
      }
      if (command.status === 'Timeout') {
        return (
          Result.isFailure(result) &&
          S.is(RunFailure)(result.failure) &&
          Predicate.isTagged(result.failure.evidence, 'BaselineTimedOut') &&
          result.failure.evidence.stage === 'dryRun'
        )
      }
      if (command.testCount === 0 && command.allowEmpty === false) {
        return (
          Result.isFailure(result) &&
          S.is(RunFailure)(result.failure) &&
          Predicate.isTagged(result.failure.evidence, 'BaselineFoundNoTests') &&
          result.failure.evidence.stage === 'dryRun'
        )
      }
      if (command.failedTestCount > 0) {
        return (
          Result.isSuccess(result) &&
          S.is(DryRunFailed)(result.success) &&
          result.success.testCount === command.testCount &&
          result.success.failedTestCount === command.failedTestCount &&
          Array.isArray(result.success.failedTests) &&
          Equal.equals(result.success.failedTests, command.failedTests)
        )
      }
      return (
        Result.isSuccess(result) &&
        S.is(DryRunPassed)(result.success) &&
        result.success.testCount === command.testCount
      )
    },
  )
})
