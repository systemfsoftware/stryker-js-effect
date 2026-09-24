import { Workflow } from '@systemfsoftware/effect-cell-types'
import { ChildProcessCrashedError, OutOfMemoryError } from './Worker.schema.js'
import * as Match from 'effect/Match'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

export class ClassifyWorkerExitCommand extends S.TaggedClass<ClassifyWorkerExitCommand>()(
  'ClassifyWorkerExitCommand',
  {
    pid: S.Int,
    exitCode: S.Int,
  },
) {
  static readonly [Workflow.InstrumentationBrand] = {} as const
}

const OUT_OF_MEMORY_EXIT_CODES = [128 + 6, 128 + 9]

const decide = (command: ClassifyWorkerExitCommand) =>
  Match.value(OUT_OF_MEMORY_EXIT_CODES.includes(command.exitCode)).pipe(
    Match.when(true, () => Result.succeed(OutOfMemoryError.make({ pid: command.pid, exitCode: command.exitCode }))),
    Match.orElse(() =>
      Result.succeed(
        ChildProcessCrashedError.make({
          pid: command.pid,
          exit: { _tag: 'Code', code: command.exitCode },
          cause: 'worker exited before it accepted the RPC connection',
        }),
      )),
  )

export const classifyWorkerExit = Workflow.make({
  command: ClassifyWorkerExitCommand,
  decision: S.Union([ChildProcessCrashedError, OutOfMemoryError]),
  error: S.Never,
  decide,
})
