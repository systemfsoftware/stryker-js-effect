import { MicroVM } from '@systemfsoftware/effect-microsandbox'
import type { Readiness } from '@systemfsoftware/effect-readiness'
import { Context, Effect } from 'effect'
import * as Crypto from 'effect/Crypto'
import * as FileSystem from 'effect/FileSystem'

import { ExitFailure, GuestJobFailure, GuestSignaledFailure } from './harness-failure.schema.js'

export interface GuestJobsShape {
  readonly job: (
    cmd: readonly [string, ...Array<string>],
    mounts: ReadonlyArray<MicroVM.Mount>,
  ) => MicroVM.JobBlueprint
  readonly requireCleanExit: (
    step: string,
    job: MicroVM.JobBlueprint,
  ) => Effect.Effect<
    void,
    ExitFailure | GuestJobFailure | GuestSignaledFailure,
    Crypto.Crypto | FileSystem.FileSystem | Readiness.HostProber
  >
}

export class GuestJobs
  extends Context.Service<GuestJobs, GuestJobsShape>()('@systemfsoftware/stryker-e2e/Harness/GuestJobs')
{
  static readonly BASE_IMAGE = 'node:24-alpine@sha256:333f6b3eca25980d5682c26207665b93c9417786b21760b2764d5821d9704c8a'
  static readonly GUEST_MEMORY_MIB = 4096
  static readonly GUEST_WORKROOT = '/work'
  static readonly GUEST_BAKED_ROOT = '/baked'
  static readonly GUEST_PACKS_ROOT = '/packs'
  static readonly STDERR_TAIL_CHARS = 4000
}
