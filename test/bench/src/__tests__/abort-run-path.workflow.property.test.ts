import { describe, it } from '@systemfsoftware/vitest'
import * as Match from 'effect/Match'
import * as Result from 'effect/Result'

import { abortRunPath, AbortRunPathCommand } from '../abort-run-path.workflow.js'
import { RunPathFailure } from '../run-path.schema.js'

const expectedOf = (failure: RunPathFailure): { readonly code: string; readonly paths: ReadonlyArray<string> } =>
  Match.valueTags(failure, {
    RunPathOccupied: (occupied) => ({ code: 'run-path-occupied', paths: [occupied.runPath] }),
    RunPathUnlisted: (unlisted) => ({ code: 'run-path-move-failed', paths: [unlisted.runnerTemp] }),
    RunPathOutsideTree: (outside) => ({ code: 'run-path-move-failed', paths: [outside.path, outside.tree] }),
    RunPathMoveInFailed: (failed) => ({ code: 'run-path-move-failed', paths: [failed.tree, failed.runPath] }),
    RunPathUnrestored: (unrestored) => ({ code: 'run-path-unrestored', paths: [unrestored.runPath, unrestored.tree] }),
  })

describe('abortRunPath', () => {
  it.prop(
    '∀f_RunPathFailure_≡ItsAbortCodeWithAReasonNamingTheSideAndPaths',
    { of: [RunPathFailure], subject: abortRunPath },
    (subject, [failure]) => {
      const abort = Result.merge(subject(AbortRunPathCommand.make({ failure })))
      const expected = expectedOf(failure)
      return abort.code === expected.code &&
        abort.reason.startsWith(`side ${failure.side}: `) &&
        expected.paths.every((path) => abort.reason.includes(path))
    },
  )
})
