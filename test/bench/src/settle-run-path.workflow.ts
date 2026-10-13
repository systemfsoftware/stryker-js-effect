import { Workflow } from '@systemfsoftware/effect-cell-types'
import { BenchSide } from '@systemfsoftware/stryker-e2e-core'
import * as Arr from 'effect/Array'
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

const PATH = 'p'

const acceptsSettleCommand = (tree: string, runPath: string): boolean =>
  Result.isSuccess(
    S.decodeResult(SettleRunPathCommand)({
      _tag: 'SettleRunPathCommand',
      side: 'A',
      tree,
      runPath,
      moveBack: { _tag: 'MovedBack' },
      run: { _tag: 'RunSucceeded' },
    }),
  )

const pathFieldVerdicts = (value: string): ReadonlyArray<boolean> => [
  acceptsSettleCommand(value, PATH),
  acceptsSettleCommand(PATH, value),
]

if (import.meta.vitest !== void 0) {
  const { it } = await import('@systemfsoftware/vitest')

  const boundaryValues = ['', ' ', PATH]

  it.prop(
    '∀s_SettleRunPathCommandRefusal_≡EveryPathFieldRefusesOnlyTheEmptyString',
    { of: [S.String], subject: pathFieldVerdicts },
    (subject, [drawn]) =>
      Arr.every(
        Arr.append(boundaryValues, drawn),
        (value) => Arr.every(subject(value), (accepted) => accepted === value.length > 0),
      ),
  )
}
