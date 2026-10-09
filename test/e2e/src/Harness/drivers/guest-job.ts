import { MicroVM } from '@systemfsoftware/effect-microsandbox'
import { Boolean, Effect, Layer, Match } from 'effect'

import { GuestJobs } from '../guest-job.service.js'
import { ExitFailure, GuestJobFailure, GuestSignaledFailure } from '../harness-failure.schema.js'
import { seamSpan, SpanNames } from '../seam-span.js'

export const layer = Layer.effect(
  GuestJobs,
  Effect.sync(() => {
    const stderrTailOf = (stderr: Uint8Array) => new TextDecoder().decode(stderr).slice(-GuestJobs.STDERR_TAIL_CHARS)

    const job = (cmd: readonly [string, ...Array<string>], mounts: ReadonlyArray<MicroVM.Mount>) =>
      mounts.reduce(
        (resource, mount) => resource.withMount(mount),
        MicroVM.job(GuestJobs.BASE_IMAGE, cmd).withMemoryLimit(GuestJobs.GUEST_MEMORY_MIB),
      )

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

    const requireCleanExit = (step: string, job: MicroVM.JobBlueprint) =>
      Effect.flatMap(
        runGuestJob(step, job),
        (completion) =>
          Effect.flatMap(requireExited(step, completion), (code) =>
            Boolean.match(code === 0, {
              onTrue: () => Effect.void,
              onFalse: () =>
                Effect.fail(new ExitFailure({ step, exitCode: code, stderrTail: stderrTailOf(completion.stderr) })),
            })),
      )

    return { job, requireCleanExit }
  }),
)
