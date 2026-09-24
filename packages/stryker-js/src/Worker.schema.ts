import { Schema as S } from 'effect'

// ---------------------------------------------------------------------------
// IPC — method call / reply
// ---------------------------------------------------------------------------

/**
 * Method threw — the worker stayed up. Distinct from a crash: the pool
 * retires a crashed worker but not one whose method rejected.
 */
export class WorkerMethodError extends S.TaggedError<WorkerMethodError>()('WorkerMethodError', {
  message: S.String,
  name: S.optional(S.String),
  stack: S.optional(S.String),
}) {}

// ---------------------------------------------------------------------------
// Process exit — crash discriminants
// ---------------------------------------------------------------------------

export const ProcessId = S.NonNegativeInt

export const ChildExitCode = S.NonNegativeInt

const ChildExit = S.Union([
  S.Struct({ _tag: S.Literals(['Code']), code: S.Int }),
  S.Struct({ _tag: S.Literals(['Signal']), signal: S.NonEmptyString }),
])

export type ChildExit = typeof ChildExit.Type

/**
 * The child process hosting a worker ended when it was not supposed to.
 */
const WorkerExitTypeId: unique symbol = Symbol.for('@systemfsoftware/stryker-js/WorkerExit')
type WorkerExitTypeId = typeof WorkerExitTypeId

export class ChildProcessCrashedError extends S.TaggedError<ChildProcessCrashedError>()(
  'ChildProcessCrashedError',
  {
    pid: ProcessId,
    exit: ChildExit,
    cause: S.optional(S.String),
  },
) {
  readonly [WorkerExitTypeId] = WorkerExitTypeId
  readonly exitClass = 'InternalError' as const
}

export class OutOfMemoryError extends S.TaggedError<OutOfMemoryError>()('OutOfMemoryError', {
  pid: ProcessId,
  exitCode: ChildExitCode,
}) {
  readonly [WorkerExitTypeId] = WorkerExitTypeId
  readonly exitClass = 'RuntimeError' as const
}

export type WorkerExit = ChildProcessCrashedError | OutOfMemoryError

export type WorkerBootError = WorkerExit | WorkerBootTimeoutError

export class WorkerBootTimeoutError extends S.TaggedError<WorkerBootTimeoutError>()(
  'WorkerBootTimeoutError',
  {
    pid: ProcessId,
  },
) {
  readonly exitClass = 'InternalError' as const
}

