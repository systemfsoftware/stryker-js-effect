import { describe, it } from '@systemfsoftware/vitest'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import {
  classifyEmptyDirectoryRemoval,
  ClassifyEmptyDirectoryRemovalCommand,
  RemovalFailed,
} from '../classify-empty-directory-removal.workflow.js'

describe('classifyEmptyDirectoryRemoval', () => {
  it.prop(
    '∀c_ClassifyEmptyDirectoryRemoval_⊨FailedRemovalCarriesTheErrnoItFailedWith',
    { of: [ClassifyEmptyDirectoryRemovalCommand], subject: classifyEmptyDirectoryRemoval },
    (subject, [command]) => {
      const decision = subject(command).pipe(Result.getOrElse((neverError) => neverError))
      return !S.is(RemovalFailed)(decision) || decision.code === command.code
    },
  )
})
