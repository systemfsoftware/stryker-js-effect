import { describe, it } from '@effect/vitest'
import * as Match from 'effect/Match'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import { classifyWorkerExit, ClassifyWorkerExitCommand } from '../classify-worker-exit.workflow.js'

const OUT_OF_MEMORY_EXIT_CODES = S.Literals([128 + 6, 128 + 9])

const classifiedOf = (pid: number, exitCode: number) =>
  classifyWorkerExit(new ClassifyWorkerExitCommand({ pid, exitCode }))

describe('classifyWorkerExit', () => {
  it.prop('∀oom_ClassifyWorkerExit_≡OutOfMemory', [S.Int, OUT_OF_MEMORY_EXIT_CODES], ([pid, exitCode]) =>
    Result.match(classifiedOf(pid, exitCode), {
      onFailure: () => false,
      onSuccess: (classified) =>
        Match.value(classified).pipe(
          Match.tag('OutOfMemoryError', (outOfMemory) => outOfMemory.pid === pid && outOfMemory.exitCode === exitCode),
          Match.orElse(() => false),
        ),
    }),
  )

  it.prop('∀code_ClassifyWorkerExit_≡Crash', [S.Int, S.Int], ([pid, exitCode]) => {
    const result = classifiedOf(pid, exitCode)
    return Match.value(OUT_OF_MEMORY_EXIT_CODES.includes(exitCode)).pipe(
      Match.when(true, () =>
        Result.match(result, {
          onFailure: () => false,
          onSuccess: (classified) => classified._tag === 'OutOfMemoryError',
        })),
      Match.orElse(() =>
        Result.match(result, {
          onFailure: () => false,
          onSuccess: (classified) =>
            Match.value(classified).pipe(
              Match.tag(
                'ChildProcessCrashedError',
                (crashed) =>
                  crashed.pid === pid &&
                  crashed.exit._tag === 'Code' &&
                  crashed.exit.code === exitCode,
              ),
              Match.orElse(() => false),
            ),
        })),
    )
  })
})
