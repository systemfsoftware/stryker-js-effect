import { it } from '@systemfsoftware/vitest'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import { TestRunner } from '@systemfsoftware/stryker-js-plugin-interface'
import {
  interpretDryRunResult,
  InterpretDryRunResultCommand,
  MutantRunErrored,
  MutantRunKilled,
  MutantRunSurvived,
  MutantRunTimedOut,
} from '../interpret-dry-run-result.workflow.js'

it.prop(
  '∀dryRun_InterpretDryRunResult_≡CountsTestsAndReportsKillers',
  { of: [TestRunner.DryRunResultSchema], subject: interpretDryRunResult },
  (subject, [dryRunResult]) =>
    Result.match(
      subject(InterpretDryRunResultCommand.make({ dryRunResult })),
      {
        onFailure: () => false,
        onSuccess: (decision) => {
          if (dryRunResult.status === 'error') {
            return S.is(MutantRunErrored)(decision) && decision.errorMessage === dryRunResult.errorMessage
          }
          if (dryRunResult.status === 'timeout') {
            return S.is(MutantRunTimedOut)(decision) &&
              ((dryRunResult.reason === undefined) === (decision.reason === undefined)) &&
              (dryRunResult.reason === undefined || decision.reason === dryRunResult.reason)
          }
          const failed = dryRunResult.tests.filter((test) => test.status === 'failed')
          const nrOfTests = dryRunResult.tests.filter((test) => test.status !== 'skipped').length
          const firstFailed = failed.at(0)
          if (firstFailed === undefined) {
            return S.is(MutantRunSurvived)(decision) && decision.nrOfTests === nrOfTests
          }
          return S.is(MutantRunKilled)(decision) &&
            decision.nrOfTests === nrOfTests &&
            decision.failureMessage === firstFailed.failureMessage &&
            decision.killedBy.length === failed.length &&
            failed.every((test, index) => decision.killedBy[index] === test.id)
        },
      },
    ),
)
