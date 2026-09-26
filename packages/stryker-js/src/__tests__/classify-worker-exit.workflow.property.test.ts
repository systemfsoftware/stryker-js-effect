import { describe, it } from '@systemfsoftware/vitest'
import * as Match from 'effect/Match'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import {
  classifyWorkerExit,
  ClassifyWorkerExitCommand,
  type ClassifyWorkerExitDecision,
  OutOfMemoryExitCode,
} from '../classify-worker-exit.workflow.js'
import { ChildExitCode, ProcessId } from '../Worker.schema.js'

const classifiedOf = (subject: typeof classifyWorkerExit, pid: number, exitCode: number) =>
  subject(ClassifyWorkerExitCommand.make({ pid, exitCode }))

const carriesItsCommand = (pid: number, exitCode: number) => (classified: ClassifyWorkerExitDecision) =>
  Match.value(classified).pipe(
    Match.tag('WorkerOutOfMemory', (outOfMemory) => outOfMemory.pid === pid && outOfMemory.exitCode === exitCode),
    Match.tag('WorkerCrashed', (crashed) => crashed.pid === pid && crashed.exitCode === exitCode),
    Match.exhaustive,
  )

const isOutOfMemory = (classified: ClassifyWorkerExitDecision) =>
  Match.value(classified).pipe(
    Match.tag('WorkerOutOfMemory', () => true),
    Match.tag('WorkerCrashed', () => false),
    Match.exhaustive,
  )

describe('classifyWorkerExit', () => {
  it.prop(
    '∀cp_ClassifyWorkerExit_≡ItsCommandClassifiedByDeclaredCode',
    { of: [ProcessId, ChildExitCode], subject: classifyWorkerExit },
    (subject, [pid, exitCode]) =>
      Result.match(classifiedOf(subject, pid, exitCode), {
        onFailure: () => false,
        onSuccess: (classified) =>
          carriesItsCommand(pid, exitCode)(classified) &&
          isOutOfMemory(classified) === S.is(OutOfMemoryExitCode)(exitCode),
      }),
  )
})
