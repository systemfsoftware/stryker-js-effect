import { describe, it } from '@systemfsoftware/vitest'
import * as Match from 'effect/Match'
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
      return Match.value(command.observation).pipe(
        Match.tag(
          'RunSucceededClean',
          () => Result.isSuccess(result) && S.is(RunOk)(result.success) && result.success.help === false,
        ),
        Match.tag(
          'RunSucceededVerdict',
          (observation) => isRunFailed(result, classCode(observation.exitClass), observation.diagnostic ?? undefined),
        ),
        Match.tag(
          'RunInterruptedObservation',
          () => Result.isFailure(result) && S.is(RunInterrupted)(result.failure) && result.failure.code === 130,
        ),
        Match.tag('RunHelpObservation', (observation) =>
          observation.errorCount > 0
            ? Result.isSuccess(result) &&
              S.is(RunParseFailed)(result.success) &&
              result.success.unrecognized === (observation.unrecognized ?? undefined)
            : Result.isSuccess(result) && S.is(RunOk)(result.success) && result.success.help === true),
        Match.tag(
          'RunCliErrorObservation',
          (observation) =>
            Result.isSuccess(result) &&
            S.is(RunParseFailed)(result.success) &&
            result.success.unrecognized === (observation.unrecognized ?? undefined),
        ),
        Match.tag(
          'RunSurvivorsRejectedObservation',
          (observation) =>
            Result.isSuccess(result) &&
            S.is(RunSurvivorsRejected)(result.success) &&
            result.success.reason === observation.reason &&
            result.success.diagnostic === (observation.diagnostic ?? undefined),
        ),
        Match.tag(
          'RunSchemaErrorObservation',
          (observation) =>
            Result.isSuccess(result) &&
            S.is(RunConfigFailed)(result.success) &&
            result.success.detail === (observation.configDetail ?? undefined),
        ),
        Match.tag('RunClassedObservation', (observation) =>
          observation.exitClass === 'ConfigError'
            ? Result.isSuccess(result) &&
              S.is(RunConfigFailed)(result.success) &&
              result.success.detail === (observation.configDetail ?? undefined)
            : isRunFailed(result, classCode(observation.exitClass), observation.diagnostic ?? undefined)),
        Match.tag(
          'RunGenericFailureObservation',
          (observation) => isRunFailed(result, 1, observation.diagnostic ?? undefined),
        ),
        Match.exhaustive,
      )
    },
  )
})
