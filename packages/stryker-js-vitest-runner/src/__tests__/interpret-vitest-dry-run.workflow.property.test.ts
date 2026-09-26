import { describe } from '@systemfsoftware/vitest'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import type { TestRunner } from '@systemfsoftware/stryker-js-plugin-interface'
import { DryRunComplete, DryRunExternalError, interpretVitestDryRun } from '../interpret-vitest-dry-run.workflow.js'
import { VitestDryRunCommand } from '../vitest-run-command.schema.js'

const withTests = (
  input: VitestDryRunCommand,
  tests: readonly TestRunner.TestResult[],
  externalError: boolean,
): VitestDryRunCommand =>
  VitestDryRunCommand.make({
    projectRoot: input.projectRoot,
    tests: [...tests],
    hasExternalError: externalError,
    externalErrorText: input.externalErrorText,
  })

describe('interpretVitestDryRun', (it) => {
  it.prop(
    '→t_FailedTest_=Complete',
    {
      of: [
        VitestDryRunCommand,
        S.String.check(S.isMinLength(1), S.isMaxLength(24)),
        S.String.check(S.isMaxLength(32)),
      ],
      subject: interpretVitestDryRun,
    },
    (subject, [input, name, message]) => {
      const failed: TestRunner.FailedTestResult = {
        id: `tests/a.spec.ts#${name}`,
        name,
        timeSpentMs: 5,
        status: 'failed',
        failureMessage: message,
        fileName: 'tests/a.spec.ts',
      }
      const result = subject(withTests(input, [...input.tests, failed], true))
      if (!Result.isSuccess(result)) {
        return false
      }
      if (!S.is(DryRunComplete)(result.success)) {
        return false
      }
      return result.success.tests.some((test) => test.id === failed.id)
    },
  )

  it.prop(
    '→e_ExternalErrorWithoutFailure_=Error',
    { of: [VitestDryRunCommand], subject: interpretVitestDryRun },
    (subject, [input]) => {
      const result = subject(
        withTests(
          input,
          input.tests.filter((test) => test.status !== 'failed'),
          true,
        ),
      )
      if (!Result.isSuccess(result)) {
        return false
      }
      if (!S.is(DryRunExternalError)(result.success)) {
        return false
      }
      return result.success.errorMessage === `An error occurred outside of a test run: ${input.externalErrorText}`
    },
  )
})
