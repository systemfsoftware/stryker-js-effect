import { describe, it } from '@systemfsoftware/vitest'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import { Arbitrary } from 'effect/unstable/arbitrary'

import {
  admitNonEmptyProject,
  NonEmptyProjectCommand,
  ProjectAdmitted,
  ProjectEmpty,
} from '../run/admit-non-empty-project.workflow.js'

const fileCountArb = Arbitrary.schema(S.Int.check(S.isGreaterThanOrEqualTo(0)))

describe('admitNonEmptyProject', () => {
  it.prop(
    '∀n_FileCount_≡EmptyOnlyWhenZero',
    { of: [fileCountArb], subject: admitNonEmptyProject },
    (subject, [fileCount]) => {
      const result = subject(NonEmptyProjectCommand.make({ fileCount }))
      if (!Result.isSuccess(result)) {
        return false
      }
      return fileCount === 0 ? S.is(ProjectEmpty)(result.success) : S.is(ProjectAdmitted)(result.success)
    },
  )
})
