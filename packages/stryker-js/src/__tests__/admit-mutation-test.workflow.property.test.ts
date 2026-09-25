import { describe, it } from '@systemfsoftware/vitest'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import {
  admitMutationTest,
  MutationTestDryRunOnly,
  MutationTestError,
  MutationTestNoTests,
  MutationTestProceed,
} from '../admit-mutation-test.workflow.js'
import { MutationTestCommand } from '../MutationTest.schema.js'

describe('admitMutationTest', () => {
  it.prop(
    '∀c_Command_≡Decision',
    { of: [MutationTestCommand], subject: admitMutationTest },
    (subject, [command]) => {
      const result = subject(command)
      if (command.testCount < 0) {
        return Result.isFailure(result) && S.is(MutationTestError)(result.failure)
      }
      if (command.dryRunOnly) {
        return Result.isSuccess(result) && S.is(MutationTestDryRunOnly)(result.success)
      }
      if (command.isZero && command.allowEmpty) {
        return Result.isSuccess(result) && S.is(MutationTestNoTests)(result.success)
      }
      return Result.isSuccess(result) && S.is(MutationTestProceed)(result.success)
    },
  )

  it.prop(
    '∀r_MutationTestError_≡MessageIsReason',
    {
      of: [S.String],
      subject: (reason: string): string => MutationTestError.make({ stage: 'mutationTest', reason }).message,
    },
    (messageOf, [reason]) => messageOf(reason) === reason,
  )
})
