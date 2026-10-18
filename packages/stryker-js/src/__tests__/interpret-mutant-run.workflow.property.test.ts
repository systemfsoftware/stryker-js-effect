import { it } from '@systemfsoftware/vitest'
import * as Boolean from 'effect/Boolean'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import {
  interpretMutantRun,
  MutantRunConfirm,
  MutantRunNeverStarted,
  MutantRunObservation,
  MutantRunRetry,
  MutantRunRetryExhausted,
  MutantRunSettled,
  MutantRunTimeoutConfirmed,
} from '../interpret-mutant-run.workflow.js'

const intersects = (covering: readonly string[], executed: readonly string[]): boolean =>
  covering.some((id) => executed.includes(id))

const coveringTestMissing = (command: MutantRunObservation): boolean =>
  command.coveringTests.length > 0 &&
  command.executedTests !== undefined &&
  !intersects(command.coveringTests, command.executedTests)

const twiceOrLargest = (timeoutMs: number): number => Number.isFinite(timeoutMs * 2) ? timeoutMs * 2 : Number.MAX_VALUE

it.prop(
  '∀c_Observation_≡AFirstAttemptThatReplacedItsWorkerConfirmsUnderTwiceTheDeadline',
  { of: [MutantRunObservation], subject: interpretMutantRun },
  (subject, [command]) =>
    Result.match(subject(command), {
      onFailure: () => false,
      onSuccess: (decision) =>
        Boolean.match(command.workerReplaced && !command.confirming, {
          onTrue: () => S.is(MutantRunConfirm)(decision) && decision.timeoutMs === twiceOrLargest(command.timeoutMs),
          onFalse: () => !S.is(MutantRunConfirm)(decision),
        }),
    }),
)

it.prop(
  '∀c_Observation_≡OnlyAConfirmationThatRanAndExpiredSettlesAsATimeout',
  { of: [MutantRunObservation], subject: interpretMutantRun },
  (subject, [command]) =>
    Result.match(subject(command), {
      onFailure: () => false,
      onSuccess: (decision) =>
        S.is(MutantRunTimeoutConfirmed)(decision) ===
          (command.workerReplaced && command.confirming && !command.neverStarted),
    }),
)

it.prop(
  '∀c_Observation_≡AConfirmationWhoseRunnerNeverStartedIsNoTimeout',
  { of: [MutantRunObservation], subject: interpretMutantRun },
  (subject, [command]) =>
    Result.match(subject(command), {
      onFailure: () => false,
      onSuccess: (decision) =>
        S.is(MutantRunNeverStarted)(decision) ===
          (command.workerReplaced && command.confirming && command.neverStarted),
    }),
)

it.prop(
  '∀c_Observation_≡WithoutAnExpiryMissingCoveringTestRetriesOnceThenExhausts',
  { of: [MutantRunObservation], subject: interpretMutantRun },
  (subject, [command]) =>
    Result.match(subject(command), {
      onFailure: () => false,
      onSuccess: (decision) =>
        Boolean.match(command.workerReplaced, {
          onTrue: () => !S.is(MutantRunSettled)(decision) && !S.is(MutantRunRetry)(decision),
          onFalse: () =>
            Boolean.match(coveringTestMissing(command), {
              onTrue: () =>
                Boolean.match(command.attempt === 0, {
                  onTrue: () => S.is(MutantRunRetry)(decision),
                  onFalse: () => S.is(MutantRunRetryExhausted)(decision),
                }),
              onFalse: () => S.is(MutantRunSettled)(decision),
            }),
        }),
    }),
)
