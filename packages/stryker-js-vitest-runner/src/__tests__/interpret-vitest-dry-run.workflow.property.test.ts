import { TestRunner } from '@systemfsoftware/stryker-js-plugin-interface'
import { describe } from '@systemfsoftware/vitest'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import { DryRunExternalError, interpretVitestDryRun } from '../interpret-vitest-dry-run.workflow.js'
import { VitestDryRunCommand } from '../vitest-run-command.schema.js'

const PROJECT_ROOT = '/project'

const dryRunCommandOf = (input: {
  readonly tests: readonly TestRunner.TestResult[]
  readonly hasExternalError: boolean
  readonly externalErrorText: string
}): VitestDryRunCommand =>
  VitestDryRunCommand.make({
    projectRoot: PROJECT_ROOT,
    tests: input.tests,
    hasExternalError: input.hasExternalError,
    externalErrorText: input.externalErrorText,
  })

describe('interpretVitestDryRun', (it) => {
  it.prop(
    '∀c_DryRunCommand_≡ErrorIffExternalErrorWithoutFailure',
    { of: [VitestDryRunCommand], subject: interpretVitestDryRun },
    (subject, [command]) => {
      const failed = command.tests.some((test) => test.status === 'failed')
      return Result.match(subject(command), {
        onFailure: () => false,
        onSuccess: (outcome) => S.is(DryRunExternalError)(outcome) === (!failed && command.hasExternalError),
      })
    },
  )

  it.prop(
    '∀c_DryRunCommand_≡ErrorMessageNamesTheExternalError',
    {
      of: [VitestDryRunCommand, S.String.check(S.isMinLength(1), S.isMaxLength(32))],
      subject: interpretVitestDryRun,
    },
    (subject, [command, externalErrorText]) => {
      const forced = dryRunCommandOf({
        tests: command.tests.filter((test) => test.status !== 'failed'),
        hasExternalError: true,
        externalErrorText,
      })
      return Result.match(subject(forced), {
        onFailure: () => false,
        onSuccess: (outcome) =>
          S.is(DryRunExternalError)(outcome) &&
          outcome.errorMessage === `An error occurred outside of a test run: ${externalErrorText}`,
      })
    },
  )
})
