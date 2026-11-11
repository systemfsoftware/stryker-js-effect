import type { MicroVM } from '@systemfsoftware/effect-microsandbox'
import { Boolean, Effect, Layer, Match } from 'effect'

import { GuestJobs, type GuestJobsShape, type GuestMount } from './guest-job.service.js'
import { ExitFailure, GuestJobFailure, GuestSignaledFailure } from './harness-failure.schema.js'
import { seamSpan, SpanNames } from './harness-telemetry.js'
import { guestJobOf } from './microsandbox-job.js'

const stderrTailOf = (stderr: Uint8Array) => new TextDecoder().decode(stderr).slice(-GuestJobs.STDERR_TAIL_CHARS)

const runGuestJob = (step: string, job: MicroVM.JobBlueprint) =>
  Effect.scoped(job.run).pipe(
    Effect.mapError((cause) => new GuestJobFailure({ step, cause })),
    seamSpan(SpanNames.guestJob, { 'e2e.job.step': step }),
  )

const requireExited = (step: string, completion: MicroVM.JobCompletion) =>
  Match.value(completion.status).pipe(
    Match.tag('JobSignaled', () =>
      Effect.fail(
        new GuestSignaledFailure({
          step,
          memoryMiB: GuestJobs.GUEST_MEMORY_MIB,
          stderrTail: stderrTailOf(completion.stderr),
        }),
      )),
    Match.tag('JobExited', (status) => Effect.succeed(status.code)),
    Match.exhaustive,
  )

const requireCleanExit = (
  step: string,
  cmd: readonly [string, ...Array<string>],
  mounts: ReadonlyArray<GuestMount>,
) =>
  Effect.flatMap(
    runGuestJob(step, guestJobOf(cmd, mounts)),
    (completion) =>
      Effect.flatMap(requireExited(step, completion), (code) =>
        Boolean.match(code === 0, {
          onTrue: () => Effect.void,
          onFalse: () =>
            Effect.fail(new ExitFailure({ step, exitCode: code, stderrTail: stderrTailOf(completion.stderr) })),
        })),
  )

export const make: Effect.Effect<GuestJobsShape> = Effect.sync(() => ({ requireCleanExit }))

export const layer: Layer.Layer<GuestJobs> = Layer.effect(GuestJobs, make)
