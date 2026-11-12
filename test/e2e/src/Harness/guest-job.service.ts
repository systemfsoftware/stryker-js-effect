import type { Readiness } from '@systemfsoftware/effect-readiness'
import { Context, type Effect } from 'effect'
import type * as SecureRandom from 'effect/crypto/SecureRandom'
import type * as FileSystem from 'effect/FileSystem'

import type { ExitFailure, GuestJobFailure, GuestSignaledFailure } from './harness-failure.schema.js'

export interface GuestMount {
  readonly host: string
  readonly guest: string
}

export interface GuestJobsShape {
  readonly requireCleanExit: (
    step: string,
    cmd: readonly [string, ...Array<string>],
    mounts: ReadonlyArray<GuestMount>,
  ) => Effect.Effect<
    void,
    ExitFailure | GuestJobFailure | GuestSignaledFailure,
    SecureRandom.SecureRandom | FileSystem.FileSystem | Readiness.HostProber
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
