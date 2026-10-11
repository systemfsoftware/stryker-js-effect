import { Workflow } from '@systemfsoftware/effect-cell-types'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import { BenchSide } from './bench-run.schema.js'
import { RunPathRestored, RunPathUnrestored } from './run-path.schema.js'

export class SettleRunPathCommand extends S.TaggedClass<SettleRunPathCommand>()('SettleRunPathCommand', {
  side: BenchSide,
  tree: S.NonEmptyString,
  runPath: S.NonEmptyString,
  restoreError: S.NullOr(S.String),
  runFailure: S.NullOr(S.String),
}) {
  static readonly [Workflow.InstrumentationBrand] = {} as const
}

const decide = (command: SettleRunPathCommand): Result.Result<RunPathRestored, RunPathUnrestored> =>
  Option.match(Option.fromNullOr(command.restoreError), {
    onNone: () => Result.succeed(RunPathRestored.make({ side: command.side, tree: command.tree })),
    onSome: (restoreError) =>
      Result.fail(
        RunPathUnrestored.make({
          side: command.side,
          tree: command.tree,
          runPath: command.runPath,
          restoreError,
          runFailure: command.runFailure,
        }),
      ),
  })

export const settleRunPath = Workflow.make({
  command: SettleRunPathCommand,
  decision: RunPathRestored,
  error: RunPathUnrestored,
  decide,
})
