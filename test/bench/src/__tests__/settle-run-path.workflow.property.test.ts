import { describe, it } from '@systemfsoftware/vitest'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import { RunPathMoveBack, RunPathRestored, RunPathRunEnd, RunPathUnrestored } from '../run-path.schema.js'
import { settleRunPath, SettleRunPathCommand } from '../settle-run-path.workflow.js'

const sameRunEnd = (actual: RunPathRunEnd, expected: RunPathRunEnd): boolean =>
  RunPathRunEnd.match(expected, {
    RunSucceeded: () => S.is(RunPathRunEnd.cases.RunSucceeded)(actual),
    RunFailed: (failed) =>
      RunPathRunEnd.match(actual, {
        RunSucceeded: () => false,
        RunFailed: (carried) => Object.is(carried.cause, failed.cause),
      }),
  })
describe('settleRunPath', () => {
  it.prop(
    '∀srp_AnyRunOutcome_≡UnrestoredIffTheMoveBackFailedCarryingBothCauses',
    { of: [SettleRunPathCommand], subject: settleRunPath },
    (subject, [command]) => {
      const result = subject(command)
      return RunPathMoveBack.match(command.moveBack, {
        MovedBack: () =>
          Result.match(result, {
            onSuccess: (restored) =>
              S.is(RunPathRestored)(restored) && restored.side === command.side && restored.tree === command.tree,
            onFailure: () => false,
          }),
        MoveBackFailed: (failed) =>
          Result.match(result, {
            onSuccess: () => false,
            onFailure: (unrestored) =>
              S.is(RunPathUnrestored)(unrestored) &&
              unrestored.side === command.side &&
              unrestored.tree === command.tree &&
              unrestored.runPath === command.runPath &&
              Object.is(unrestored.cause, failed.cause) &&
              sameRunEnd(unrestored.run, command.run),
          }),
      })
    },
  )
})
