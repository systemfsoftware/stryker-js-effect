import { it } from '@systemfsoftware/vitest'
import * as Boolean from 'effect/Boolean'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import {
  interpretMutantRun,
  MutantRunObservation,
  MutantRunPoolInvalidated,
  MutantRunRetry,
  MutantRunRetryExhausted,
  MutantRunSettled,
} from '../interpret-mutant-run.workflow.js'

const intersects = (covering: readonly string[], executed: readonly string[]): boolean =>
  covering.some((id) => executed.includes(id))

const coveringTestMissing = (command: MutantRunObservation): boolean =>
  command.coveringTests.length > 0 &&
  command.executedTests !== undefined &&
  !intersects(command.coveringTests, command.executedTests)

it.prop(
  '∀c_Observation_≡OnlyAWallClockClipRecyclesTheRunner',
  { of: [MutantRunObservation], subject: interpretMutantRun },
  (subject, [command]) =>
    Result.match(subject(command), {
      onFailure: () => false,
      onSuccess: (decision) => S.is(MutantRunPoolInvalidated)(decision) === command.wallClockTimeout,
    }),
)

it.prop(
  '∀c_Observation_≡MissingCoveringTestRetriesOnceThenExhausts',
  { of: [MutantRunObservation], subject: interpretMutantRun },
  (subject, [command]) =>
    Result.match(subject(command), {
      onFailure: () => false,
      onSuccess: (decision) =>
        Boolean.match(command.wallClockTimeout, {
          onTrue: () => S.is(MutantRunPoolInvalidated)(decision),
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
