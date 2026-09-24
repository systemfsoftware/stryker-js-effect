import { Workflow } from '@systemfsoftware/effect-cell-types'
import * as Boolean from 'effect/Boolean'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import { ChildExitCode, ProcessId } from './Worker.schema.js'

const WorkerExitTypeId: unique symbol = Symbol.for('@systemfsoftware/stryker-js/WorkerExit')
type WorkerExitTypeId = typeof WorkerExitTypeId

export class ClassifyWorkerExitCommand extends S.TaggedClass<ClassifyWorkerExitCommand>()(
  'ClassifyWorkerExitCommand',
  {
    pid: ProcessId,
    exitCode: ChildExitCode,
  },
) {
  static readonly [Workflow.InstrumentationBrand] = {} as const
}

export class WorkerOutOfMemory extends S.TaggedClass<WorkerOutOfMemory>()('WorkerOutOfMemory', {
  pid: ProcessId,
  exitCode: ChildExitCode,
}) {
  readonly [WorkerExitTypeId] = WorkerExitTypeId
}

export class WorkerCrashed extends S.TaggedClass<WorkerCrashed>()('WorkerCrashed', {
  pid: ProcessId,
  exitCode: ChildExitCode,
}) {
  readonly [WorkerExitTypeId] = WorkerExitTypeId
}

export const ClassifyWorkerExitDecision = S.Union([WorkerOutOfMemory, WorkerCrashed])
export type ClassifyWorkerExitDecision = typeof ClassifyWorkerExitDecision.Type

const OUT_OF_MEMORY_EXIT_CODES = [128 + 6, 128 + 9]

const decide = (command: ClassifyWorkerExitCommand) =>
  Boolean.match(OUT_OF_MEMORY_EXIT_CODES.includes(command.exitCode), {
    onTrue: () => Result.succeed(WorkerOutOfMemory.make({ pid: command.pid, exitCode: command.exitCode })),
    onFalse: () => Result.succeed(WorkerCrashed.make({ pid: command.pid, exitCode: command.exitCode })),
  })

export const classifyWorkerExit = Workflow.make({
  command: ClassifyWorkerExitCommand,
  decision: ClassifyWorkerExitDecision,
  error: S.Never,
  decide,
})
