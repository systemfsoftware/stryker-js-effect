import { MicroVM } from '@systemfsoftware/effect-microsandbox'
import type { Readiness } from '@systemfsoftware/effect-readiness'
import { Boolean, Context, Effect, Layer, Match } from 'effect'
import * as Crypto from 'effect/Crypto'
import * as FileSystem from 'effect/FileSystem'

import { ExitFailure, GuestJobFailure, GuestSignaledFailure } from './harness-failure.schema.js'

export interface GuestJobsShape {
  readonly job: (
    cmd: readonly [string, ...Array<string>],
    mounts: ReadonlyArray<MicroVM.Mount>,
  ) => MicroVM.JobResource
  readonly runGuestJob: (
    step: string,
    job: MicroVM.JobResource,
  ) => Effect.Effect<MicroVM.JobCompletion, GuestJobFailure, Crypto.Crypto | FileSystem.FileSystem | Readiness.HostProber>
  readonly requireExited: (
    step: string,
    completion: MicroVM.JobCompletion,
  ) => Effect.Effect<number, GuestSignaledFailure>
  readonly requireCleanExit: (
    step: string,
    job: MicroVM.JobResource,
  ) => Effect.Effect<void, ExitFailure | GuestJobFailure | GuestSignaledFailure, Crypto.Crypto | FileSystem.FileSystem | Readiness.HostProber>
}

export class GuestJobs extends Context.Service<GuestJobs, GuestJobsShape>()('@systemfsoftware/stryker-e2e/Harness/GuestJobs') {
  static readonly BASE_IMAGE = 'node:24-alpine@sha256:333f6b3eca25980d5682c26207665b93c9417786b21760b2764d5821d9704c8a'
  static readonly GUEST_MEMORY_MIB = 4096
  static readonly GUEST_WORKROOT = '/work'
  static readonly GUEST_BAKED_ROOT = '/baked'
  static readonly GUEST_PACKS_ROOT = '/packs'
  static readonly STDERR_TAIL_CHARS = 4000

  static readonly layer = Layer.effect(
    GuestJobs,
    Effect.sync(() => {
      const stderrTailOf = (stderr: Uint8Array) =>
        new TextDecoder().decode(stderr).slice(-GuestJobs.STDERR_TAIL_CHARS)

      const job = (cmd: readonly [string, ...Array<string>], mounts: ReadonlyArray<MicroVM.Mount>) =>
        mounts.reduce(
          (resource, mount) => resource.withMount(mount),
          MicroVM.job(GuestJobs.BASE_IMAGE, cmd).withMemoryLimit(GuestJobs.GUEST_MEMORY_MIB),
        )

      const runGuestJob = (step: string, job: MicroVM.JobResource) =>
        Effect.scoped(job.run).pipe(Effect.mapError((cause) => new GuestJobFailure({ step, cause })))

      const requireExited = (step: string, completion: MicroVM.JobCompletion) =>
        Match.value(completion.status).pipe(
          Match.tag('JobSignaled', () =>
            Effect.fail(new GuestSignaledFailure({
              step,
              memoryMiB: GuestJobs.GUEST_MEMORY_MIB,
              stderrTail: stderrTailOf(completion.stderr),
            }))),
          Match.tag('JobExited', (status) => Effect.succeed(status.code)),
          Match.exhaustive,
        )

      const requireCleanExit = (step: string, job: MicroVM.JobResource) =>
        Effect.flatMap(runGuestJob(step, job), (completion) =>
          Effect.flatMap(requireExited(step, completion), (code) =>
            Boolean.match(code === 0, {
              onTrue: () => Effect.void,
              onFalse: () =>
                Effect.fail(new ExitFailure({ step, exitCode: code, stderrTail: stderrTailOf(completion.stderr) })),
            })))

      return { job, runGuestJob, requireExited, requireCleanExit }
    }),
  )
}
