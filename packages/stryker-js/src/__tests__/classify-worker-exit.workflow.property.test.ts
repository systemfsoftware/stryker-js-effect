import { describe, it } from '@systemfsoftware/vitest'
import * as Boolean from 'effect/Boolean'
import * as Match from 'effect/Match'
import * as Result from 'effect/Result'

import { classifyWorkerExit, ClassifyWorkerExitCommand } from '../classify-worker-exit.workflow.js'
import { ChildExitCode, ProcessId } from '../Worker.schema.js'

const OUT_OF_MEMORY_EXIT_CODES: ReadonlyArray<number> = [128 + 6, 128 + 9]

const classifiedOf = (subject: typeof classifyWorkerExit, pid: number, exitCode: number) =>
  subject(ClassifyWorkerExitCommand.make({ pid, exitCode }))

describe('classifyWorkerExit', () => {
  it.prop(
    '∀code_ClassifyWorkerExit_≡OutOfMemoryIffSigabrtOrSigkill',
    { of: [ProcessId, ChildExitCode], subject: classifyWorkerExit },
    (subject, [pid, exitCode]) => {
      const result = classifiedOf(subject, pid, exitCode)
      return Boolean.match(OUT_OF_MEMORY_EXIT_CODES.includes(exitCode), {
        onTrue: () =>
          Result.match(result, {
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
    },
  )
})
