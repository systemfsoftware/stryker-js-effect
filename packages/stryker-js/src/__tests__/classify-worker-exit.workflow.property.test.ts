import { describe, it } from '@effect/vitest'
import * as Boolean from 'effect/Boolean'
import * as Match from 'effect/Match'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import { classifyWorkerExit, ClassifyWorkerExitCommand, WorkerOutOfMemory } from '../classify-worker-exit.workflow.js'
import { ChildExitCode, ProcessId } from '../Worker.schema.js'

const OUT_OF_MEMORY_CODES: ReadonlyArray<number> = [128 + 6, 128 + 9]

const classifiedOf = (pid: number, exitCode: number) =>
  classifyWorkerExit(new ClassifyWorkerExitCommand({ pid, exitCode }))

describe('classifyWorkerExit', () => {
  it.prop(
    '∀oom_ClassifyWorkerExit_≡OutOfMemory',
    [ProcessId, S.Literals([134, 137])],
    ([pid, exitCode]) =>
      Result.match(classifiedOf(pid, exitCode), {
        onFailure: () => false,
        onSuccess: (classified) =>
          Match.value(classified).pipe(
            Match.tag(
              'WorkerOutOfMemory',
              (outOfMemory) => outOfMemory.pid === pid && outOfMemory.exitCode === exitCode,
            ),
            Match.orElse(() => false),
          ),
      }),
  )

  it.prop('∀code_ClassifyWorkerExit_≡Crash', [ProcessId, ChildExitCode], ([pid, exitCode]) => {
    const result = classifiedOf(pid, exitCode)
    return Boolean.match(OUT_OF_MEMORY_CODES.includes(exitCode), {
      onTrue: () =>
        Result.match(result, {
          onFailure: () => false,
          onSuccess: (classified) => S.is(WorkerOutOfMemory)(classified),
        }),
      onFalse: () =>
        Result.match(result, {
          onFailure: () => false,
          onSuccess: (classified) =>
            Match.value(classified).pipe(
              Match.tag(
                'WorkerCrashed',
                (crashed) => crashed.pid === pid && crashed.exitCode === exitCode,
              ),
              Match.orElse(() => false),
            ),
        }),
    })
  })
})
