import { BenchSide } from '@systemfsoftware/stryker-e2e-core'
import { describe, it } from '@systemfsoftware/vitest'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import { RunPathRestored, RunPathUnrestored } from '../run-path.schema.js'
import { settleRunPath, SettleRunPathCommand } from '../settle-run-path.workflow.js'

describe('settleRunPath', () => {
  it.prop(
    '∀srp_AnyRunOutcome_≡UnrestoredIffTheMoveBackFailedKeepingBothErrors',
    {
      of: [BenchSide, S.NonEmptyString, S.NonEmptyString, S.NullOr(S.String), S.NullOr(S.String)],
      subject: settleRunPath,
    },
    (subject, [side, tree, runPath, restoreError, runFailure]) => {
      const result = subject(SettleRunPathCommand.make({ side, tree, runPath, restoreError, runFailure }))
      return Result.match(result, {
        onSuccess: (restored) =>
          restoreError === null && S.is(RunPathRestored)(restored) && restored.side === side && restored.tree === tree,
        onFailure: (unrestored) =>
          restoreError !== null &&
          S.is(RunPathUnrestored)(unrestored) &&
          unrestored.restoreError === restoreError &&
          unrestored.runFailure === runFailure &&
          unrestored.message.includes(restoreError) &&
          (runFailure === null || unrestored.message.includes(runFailure)),
      })
    },
  )
})
