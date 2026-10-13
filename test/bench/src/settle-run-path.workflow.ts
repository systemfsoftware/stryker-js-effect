import { Workflow } from '@systemfsoftware/effect-cell-types'
import { BenchSide } from '@systemfsoftware/stryker-e2e-core'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import { RunPathMoveBack, RunPathRestored, RunPathRunEnd, RunPathUnrestored } from './run-path.schema.js'

export class SettleRunPathCommand extends S.TaggedClass<SettleRunPathCommand>()('SettleRunPathCommand', {
  side: BenchSide,
  tree: S.NonEmptyString,
  runPath: S.NonEmptyString,
  moveBack: RunPathMoveBack,
  run: RunPathRunEnd,
}) {
  static readonly [Workflow.InstrumentationBrand] = {} as const
}

const decide = (command: SettleRunPathCommand): Result.Result<RunPathRestored, RunPathUnrestored> =>
  RunPathMoveBack.match(command.moveBack, {
    MovedBack: (): Result.Result<RunPathRestored, RunPathUnrestored> =>
      Result.succeed(RunPathRestored.make({ side: command.side, tree: command.tree })),
    MoveBackFailed: (failed): Result.Result<RunPathRestored, RunPathUnrestored> =>
      Result.fail(
        RunPathUnrestored.make({
          side: command.side,
          tree: command.tree,
          runPath: command.runPath,
          cause: failed.cause,
          run: command.run,
        }),
      ),
  })

export const settleRunPath = Workflow.make({
  command: SettleRunPathCommand,
  decision: RunPathRestored,
  error: RunPathUnrestored,
  decide,
})
