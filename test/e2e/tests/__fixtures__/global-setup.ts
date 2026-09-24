import { Cause, Effect, Exit, Layer } from 'effect'

import { layer as nodeServicesLayer } from '@effect/platform-node/NodeServices'
import { Readiness } from '@systemfsoftware/effect-readiness'

import { BakedFixtureCache } from '../../src/Harness/fixture-cache.service.js'
import { GuestJobs } from '../../src/Harness/guest-job.service.js'

export default async function setup(): Promise<void> {
  const exit = await Effect.runPromiseExit(
    BakedFixtureCache.bakeProgram.pipe(
      Effect.provide(Layer.mergeAll(GuestJobs.layer, nodeServicesLayer, Readiness.NodeHostProber.layer)),
    ),
  )
  const bakedRoot: string = Exit.match(exit, {
    onSuccess: (root) => root,
    onFailure: (cause) => {
      throw new Error(Cause.pretty(cause))
    },
  })
  process.env[BakedFixtureCache.BAKED_ROOT_ENV] = bakedRoot
}
