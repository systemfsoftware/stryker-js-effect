/// <reference types="vitest/importMeta" />
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

export const ProcessId = S.Int

const isPosixStatus = (n: number): boolean => n >= 0 && n <= 255

export const ChildExitCode = S.Int.pipe(S.check(S.isBetween({ minimum: 0, maximum: 255 })))
export type ChildExitCode = typeof ChildExitCode.Type

const acceptsChildExitCode = (n: number): boolean => S.is(ChildExitCode)(n)

const ChildExit = S.Union([
  S.TaggedStruct('Code', { code: ChildExitCode }),
  S.TaggedStruct('Signal', { signal: S.NonEmptyString }),
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

if (import.meta.vitest !== void 0) {
  const { it } = await import('@systemfsoftware/vitest')
  const Arr = await import('effect/Array')

  const seeds = [-1, 0, 255, 256, Number.MAX_SAFE_INTEGER, Number.NaN, Number.POSITIVE_INFINITY]
  it.prop(
    '∀n_ChildExitCodeRefusal_≡PosixStatus',
    { of: [S.Int], subject: acceptsChildExitCode },
    (subject, [drawn]) => Arr.every(Arr.append(seeds, drawn), (n) => subject(n) === isPosixStatus(n)),
  )
}
