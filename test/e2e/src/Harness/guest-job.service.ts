import { MicroVM } from '@systemfsoftware/effect-microsandbox'
import type { Readiness } from '@systemfsoftware/effect-readiness'
import { Context, Effect, Layer, Match } from 'effect'
import type * as Crypto from 'effect/Crypto'
import type * as FileSystem from 'effect/FileSystem'
import type * as Scope from 'effect/Scope'

import { ExitFailure, GuestJobFailure, GuestSignaledFailure } from './harness-failure.schema.js'
import { seamSpan, SpanNames } from './harness-telemetry.service.js'

export interface GuestJobsShape {
  readonly job: (
    cmd: readonly [string, ...Array<string>],
    mounts: ReadonlyArray<MicroVM.Mount>,
  ) => MicroVM.JobBlueprint
  readonly boot: (
    step: string,
    mounts: ReadonlyArray<MicroVM.Mount>,
  ) => Effect.Effect<
    MicroVM.RunningVM,
    GuestJobFailure,
    Scope.Scope | Crypto.Crypto | FileSystem.FileSystem | Readiness.HostProber
  >
  readonly requireCleanExec: (
    step: string,
    vm: MicroVM.RunningVM,
    argv: readonly [string, ...Array<string>],
  ) => Effect.Effect<void, ExitFailure | GuestJobFailure | GuestSignaledFailure>
}

const SIGNALED_EXIT_ABOVE = 128

export class GuestJobs
  extends Context.Service<GuestJobs, GuestJobsShape>()('@systemfsoftware/stryker-e2e/Harness/GuestJobs')
{
  static readonly BASE_IMAGE = 'node:24-alpine@sha256:333f6b3eca25980d5682c26207665b93c9417786b21760b2764d5821d9704c8a'
  static readonly GUEST_MEMORY_MIB = 4096
  static readonly GUEST_WORKROOT = '/work'
  static readonly GUEST_BAKED_ROOT = '/baked'
  static readonly GUEST_PACKS_ROOT = '/packs'
  static readonly STDERR_TAIL_CHARS = 4000
  static readonly IDLE_WORKLOAD = ['tail', '-f', '/dev/null'] as const

  static readonly layer = Layer.effect(
    GuestJobs,
    Effect.sync(() => {
      const stderrTailOf = (stderr: string) => stderr.slice(-GuestJobs.STDERR_TAIL_CHARS)

      const job = (cmd: readonly [string, ...Array<string>], mounts: ReadonlyArray<MicroVM.Mount>) =>
        mounts.reduce(
          (resource, mount) => resource.withMount(mount),
          MicroVM.job(GuestJobs.BASE_IMAGE, cmd).withMemoryLimit(GuestJobs.GUEST_MEMORY_MIB),
        )

      const boot = (step: string, mounts: ReadonlyArray<MicroVM.Mount>) =>
        job(GuestJobs.IDLE_WORKLOAD, mounts).scoped.pipe(
          Effect.mapError((cause) => new GuestJobFailure({ step, cause })),
          seamSpan(SpanNames.guestJob, { 'e2e.job.step': step }),
        )

      const requireCleanExec = (
        step: string,
        vm: MicroVM.RunningVM,
        [cmd, ...args]: readonly [string, ...Array<string>],
      ) =>
        MicroVM.exec(vm, cmd, args).pipe(
          Effect.mapError((cause) => new GuestJobFailure({ step, cause })),
          Effect.flatMap((run) =>
            Match.value(run.code).pipe(
              Match.when(0, () => Effect.void),
              Match.when((code) => code > SIGNALED_EXIT_ABOVE, () =>
                Effect.fail(
                  new GuestSignaledFailure({
                    step,
                    memoryMiB: GuestJobs.GUEST_MEMORY_MIB,
                    stderrTail: stderrTailOf(run.stderr),
                  }),
                )),
              Match.orElse((code) =>
                Effect.fail(new ExitFailure({ step, exitCode: code, stderrTail: stderrTailOf(run.stderr) }))
              ),
            )
          ),
          seamSpan(SpanNames.guestJob, { 'e2e.job.step': step }),
        )

      return { job, boot, requireCleanExec }
    }),
  )
}
