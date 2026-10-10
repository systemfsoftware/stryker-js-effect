import { Workflow } from '@systemfsoftware/effect-cell-types'
import { Workers } from '@systemfsoftware/stryker-js-contracts'
import * as Boolean from 'effect/Boolean'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

const WorkerExitTypeId: unique symbol = Symbol.for('@systemfsoftware/stryker-js/WorkerExit')
type WorkerExitTypeId = typeof WorkerExitTypeId

export class ClassifyWorkerExitCommand extends S.TaggedClass<ClassifyWorkerExitCommand>()(
  'ClassifyWorkerExitCommand',
  {
    pid: Workers.ProcessId,
    exitCode: Workers.ChildExitCode,
  },
) {
  static readonly [Workflow.InstrumentationBrand] = {} as const
}

export class WorkerOutOfMemory extends S.TaggedClass<WorkerOutOfMemory>()('WorkerOutOfMemory', {
  pid: Workers.ProcessId,
  exitCode: Workers.ChildExitCode,
}) {
  readonly [WorkerExitTypeId] = WorkerExitTypeId
}

export class WorkerCrashed extends S.TaggedClass<WorkerCrashed>()('WorkerCrashed', {
  pid: Workers.ProcessId,
  exitCode: Workers.ChildExitCode,
}) {
  readonly [WorkerExitTypeId] = WorkerExitTypeId
}

export const ClassifyWorkerExitDecision = S.Union([WorkerOutOfMemory, WorkerCrashed])
export type ClassifyWorkerExitDecision = typeof ClassifyWorkerExitDecision.Type

export const OutOfMemoryExitCode = S.Literals([128 + 6, 128 + 9])

const decide = (command: ClassifyWorkerExitCommand) =>
  Boolean.match(S.is(OutOfMemoryExitCode)(command.exitCode), {
    onTrue: () => Result.succeed(WorkerOutOfMemory.make({ pid: command.pid, exitCode: command.exitCode })),
    onFalse: () => Result.succeed(WorkerCrashed.make({ pid: command.pid, exitCode: command.exitCode })),
  })

export const classifyWorkerExit = Workflow.make({
  command: ClassifyWorkerExitCommand,
  decision: ClassifyWorkerExitDecision,
  error: S.Never,
  decide,
})
