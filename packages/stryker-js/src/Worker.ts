import { dual } from 'effect/Function'
import * as Match from 'effect/Match'

import { ChildProcessCrashedError, OutOfMemoryError } from './Worker.schema.js'

const SIGABRT = 128 + 6
const SIGKILL = 128 + 9

const OUT_OF_MEMORY_EXIT_CODES: readonly number[] = [SIGABRT, SIGKILL]

const isOutOfMemoryExit = (exitCode: number): boolean => OUT_OF_MEMORY_EXIT_CODES.includes(exitCode)

export const classifyWorkerExit: {
  (pid: number, exitCode: number): ChildProcessCrashedError | OutOfMemoryError
  (exitCode: number): (pid: number) => ChildProcessCrashedError | OutOfMemoryError
} = dual(
  2,
  (pid: number, exitCode: number): ChildProcessCrashedError | OutOfMemoryError =>
    Match.value(exitCode).pipe(
      Match.when(isOutOfMemoryExit, () => OutOfMemoryError.make({ pid, exitCode })),
      Match.orElse(() =>
        ChildProcessCrashedError.make({
          pid,
          exit: { _tag: 'Code', code: exitCode },
          cause: 'worker exited before it accepted the RPC connection',
        })
      ),
    ),
)