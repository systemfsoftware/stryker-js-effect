import { describe, it } from '@systemfsoftware/vitest'
import * as Equal from 'effect/Equal'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import { dryRun, DryRunCommand, DryRunError, DryRunFailed, DryRunPassed } from '../dry-run.workflow.js'

describe('dryRun', () => {
  it.prop(
    '∀c_Command_≡Decision',
    { of: [DryRunCommand], subject: dryRun },
    (subject, [command]) => {
      const result = subject(command)
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

  it.prop(
    '∀sr_DryRunError_≡MessageIsReason',
    {
      of: [DryRunError.fields.stage, S.String],
      subject: (stage: DryRunError['stage'], reason: string): string => DryRunError.make({ stage, reason }).message,
    },
    (messageOf, [stage, reason]) => messageOf(stage, reason) === reason,
  )
})
