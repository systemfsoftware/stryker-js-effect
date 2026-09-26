import { describe, it } from '@systemfsoftware/vitest'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import { Arbitrary } from 'effect/unstable/arbitrary'

import {
  DryRunObservation,
  DryRunObservedComplete,
  DryRunObservedFailed,
  DryRunObservedTimedOut,
  interpretDryRunObservation,
} from '../interpret-dry-run-observation.workflow.js'

const observationArb = Arbitrary.schema(DryRunObservation)

describe('interpretDryRunObservation', () => {
  it.prop(
    '∀o_Complete_≡CountsTestsAndFailures',
    { of: [observationArb], subject: interpretDryRunObservation },
    (subject, [observation]) =>
      Result.match(subject(observation), {
        onFailure: () => false,
        onSuccess: (decision) => {
          if (observation.dryRunResult.status !== 'complete') {
            return true
          }
          const failed = observation.dryRunResult.tests.filter((test) => test.status === 'failed')
          return S.is(DryRunObservedComplete)(decision) &&
            decision.testCount === observation.dryRunResult.tests.length &&
            decision.failedTestCount === failed.length &&
            decision.failedTests.length === failed.length &&
            decision.failedTests.every((summary, index) => {
              const expected = failed[index]
              return expected !== undefined &&
                summary.name === expected.name &&
                summary.failureMessage === expected.failureMessage
            })
        },
      }),
  )

  it.prop(
    '∀o_Error_≡PreservesMessage',
    { of: [observationArb], subject: interpretDryRunObservation },
    (subject, [observation]) =>
      Result.match(subject(observation), {
        onFailure: () => false,
        onSuccess: (decision) =>
          observation.dryRunResult.status !== 'error' ||
          (S.is(DryRunObservedFailed)(decision) &&
            decision.errorMessage === observation.dryRunResult.errorMessage),
      }),
  )

  it.prop(
    '∀o_Timeout_≡PreservesReason',
    { of: [observationArb], subject: interpretDryRunObservation },
    (subject, [observation]) =>
      Result.match(subject(observation), {
        onFailure: () => false,
        onSuccess: (decision) =>
          observation.dryRunResult.status !== 'timeout' ||
          (S.is(DryRunObservedTimedOut)(decision) &&
            (decision.reason ?? undefined) === (observation.dryRunResult.reason ?? undefined)),
      }),
  )
})
