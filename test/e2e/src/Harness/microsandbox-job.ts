import { MicroVM } from '@systemfsoftware/effect-microsandbox'

import { GuestJobs, type GuestMount } from './guest-job.service.js'

export const guestJobOf = (
  cmd: readonly [string, ...Array<string>],
  mounts: ReadonlyArray<GuestMount>,
): MicroVM.JobBlueprint =>
  mounts.reduce(
    (resource, mount) => resource.withMount(mount),
    MicroVM.job(GuestJobs.BASE_IMAGE, cmd).withMemoryLimit(GuestJobs.GUEST_MEMORY_MIB),
  )
