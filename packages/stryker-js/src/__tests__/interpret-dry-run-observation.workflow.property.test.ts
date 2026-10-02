import { TestRunner } from '@systemfsoftware/stryker-js-plugin-interface'
import { describe, it } from '@systemfsoftware/vitest'
import * as Arbitrary from 'effect/Arbitrary'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

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
    '∀o_Complete_≡CarriesFailedTestEvidenceInOrder',
    { of: [observationArb], subject: interpretDryRunObservation },
    (subject, [observation]) =>
      Result.match(subject(observation), {
        onFailure: () => false,
        onSuccess: (decision) => {
          if (observation.dryRunResult.status !== 'complete') {
            return true
          }
          const failed = observation.dryRunResult.tests.filter(
            (test): test is TestRunner.FailedTestResult => test.status === 'failed',
          )
          return S.is(DryRunObservedComplete)(decision) &&
            decision.testCount === observation.dryRunResult.tests.length &&
            decision.failedTestCount === failed.length &&
            decision.failedTests.length === failed.length &&
            decision.failedTests.every((evidence, index) => {
              const expected = failed[index]
              if (expected === undefined) {
                return false
              }
              const location = expected.location
              return evidence.id === expected.id &&
                evidence.name === expected.name &&
                evidence.file === (expected.fileName ?? null) &&
                (location === undefined
                  ? evidence.location === null
                  : evidence.location !== null &&
                    evidence.location.file === location.file &&
                    evidence.location.line === location.line &&
                    evidence.location.column === location.column) &&
                evidence.message === expected.failureMessage &&
                evidence.stack === (expected.stack ?? null)
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
