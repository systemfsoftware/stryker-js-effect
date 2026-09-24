import { describe, it } from '@effect/vitest'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import {
  type FailedTestResult,
  type TestResult,
} from '@systemfsoftware/stryker-js-plugin-interface'
import {
  DryRunComplete,
  DryRunExternalError,
  interpretVitestDryRun,
} from '../interpret-vitest-dry-run.workflow.js'
import { VitestDryRunCommand } from '../vitest-run-command.schema.js'

const VITEST_DRY_RUN_FAMILY = Symbol.for('@systemfsoftware/stryker-js-vitest-runner/VitestDryRun')

const carriesFamilyBrand = (decision: object): boolean =>
  Reflect.get(decision, VITEST_DRY_RUN_FAMILY) === VITEST_DRY_RUN_FAMILY

const withTests = (
  input: VitestDryRunCommand,
  tests: readonly TestResult[],
  externalError: boolean,
): VitestDryRunCommand =>
  VitestDryRunCommand.make({
    projectRoot: input.projectRoot,
    tests: [...tests],
    hasExternalError: externalError,
    externalErrorText: input.externalErrorText,
  })

describe('interpretVitestDryRun', () => {

  it.prop(
    '→t_FailedTest_=Complete',
    [
      VitestDryRunCommand,
      S.String.check(S.isMinLength(1), S.isMaxLength(24)),
      S.String.check(S.isMaxLength(32)),
    ],
    ([input, name, message]) => {
      const failed: FailedTestResult = {
        id: `tests/a.spec.ts#${name}`,
        name,
        timeSpentMs: 5,
        status: 'failed',
        failureMessage: message,
        fileName: 'tests/a.spec.ts',
      }
      const result = interpretVitestDryRun(withTests(input, [...input.tests, failed], true))
      if (!Result.isSuccess(result)) {
        return false
      }
      if (!S.is(DryRunComplete)(result.success)) {
        return false
      }
      return carriesFamilyBrand(result.success) && result.success.tests.some((test) => test.id === failed.id)
    },
  )

  it.prop(
    '→e_ExternalErrorWithoutFailure_=Error',
    [VitestDryRunCommand],
    ([input]) => {
      const result = interpretVitestDryRun(
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
      return (
        carriesFamilyBrand(result.success) &&
        result.success.errorMessage === `An error occurred outside of a test run: ${input.externalErrorText}`
      )
    },
  )
})
