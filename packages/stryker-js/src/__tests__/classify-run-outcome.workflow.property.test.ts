import { describe, it } from '@systemfsoftware/vitest'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import {
  classifyRunOutcome,
  RunConfigFailed,
  RunFailed,
  RunInterrupted,
  RunOk,
  type RunOutcomeDecision,
  type RunOutcomeError,
  RunParseFailed,
  RunSurvivorsRejected,
} from '../classify-run-outcome.workflow.js'
import { RunOutcomeCommand } from '../RunOutcomeCommand.schema.js'

const classCode = (exitClass: 'VerdictFail' | 'ConfigError' | 'RuntimeError' | 'InternalError'): number => {
  if (exitClass === 'VerdictFail') {
    return 1
  }
  if (exitClass === 'ConfigError') {
    return 2
  }
  if (exitClass === 'RuntimeError') {
    return 3
  }
  return 4
}

const isRunFailed = (
  result: Result.Result<RunOutcomeDecision, RunOutcomeError>,
  code: number,
  diagnostic: string | undefined,
): boolean =>
  Result.isSuccess(result) &&
  S.is(RunFailed)(result.success) &&
  result.success.code === code &&
  result.success.diagnostic === diagnostic

describe('classifyRunOutcome', () => {
  it.prop(
    '∀c_Command_≡TaggedOutcome',
    { of: [RunOutcomeCommand], subject: classifyRunOutcome },
    (subject, [command]) => {
      const result = subject(command)
      if (command.succeeded) {
        if (command.successExitClass === undefined) {
          return Result.isSuccess(result) && S.is(RunOk)(result.success) && result.success.help === false
        }
        return isRunFailed(result, classCode(command.successExitClass), command.diagnostic)
      }
      if (command.interrupted) {
        return Result.isFailure(result) && S.is(RunInterrupted)(result.failure) && result.failure.code === 130
      }
      if (command.helpErrorCount !== undefined) {
        if (command.helpErrorCount > 0) {
          return (
            Result.isSuccess(result) &&
            S.is(RunParseFailed)(result.success) &&
            result.success.unrecognized === command.unrecognized
          )
        }
        return Result.isSuccess(result) && S.is(RunOk)(result.success) && result.success.help === true
      }
      if (command.cliError) {
        return (
          Result.isSuccess(result) &&
          S.is(RunParseFailed)(result.success) &&
          result.success.unrecognized === command.unrecognized
        )
      }
      if (command.survivorsReason !== undefined) {
        return (
          Result.isSuccess(result) &&
          S.is(RunSurvivorsRejected)(result.success) &&
          result.success.reason === command.survivorsReason &&
          result.success.diagnostic === command.survivorsDiagnostic
        )
      }
      if (command.schemaError) {
        return (
          Result.isSuccess(result) &&
          S.is(RunConfigFailed)(result.success) &&
          result.success.detail === command.configDetail
        )
      }
      if (command.highestExitClass !== undefined) {
        if (command.highestExitClass === 'ConfigError') {
          return (
            Result.isSuccess(result) &&
            S.is(RunConfigFailed)(result.success) &&
            result.success.detail === command.configDetail
          )
        }
        const code = classCode(command.highestExitClass)
        return isRunFailed(result, code, command.diagnostic)
      }
      return isRunFailed(result, 1, command.diagnostic)
    },
  )
})
