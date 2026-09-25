import { Cause, Exit, Layer, ManagedRuntime } from 'effect'

import { layer as nodeServicesLayer } from '@effect/platform-node/NodeServices'
import { Readiness } from '@systemfsoftware/effect-readiness'

import { BakedFixtureCache } from '../../src/Harness/fixture-cache.service.js'
import { GuestJobs } from '../../src/Harness/guest-job.service.js'
import { layer as harnessTelemetryLayer } from '../../src/Harness/harness-telemetry.service.js'

const SetupLive = Layer.mergeAll(
  GuestJobs.layer,
  nodeServicesLayer,
  Readiness.NodeHostProber.layer,
  harnessTelemetryLayer,
)

export default async function setup(): Promise<() => Promise<void>> {
  const runtime = ManagedRuntime.make(SetupLive)
  const outcome = await runtime.runPromiseExit(BakedFixtureCache.bakeProgram)
  if (Exit.isFailure(outcome)) {
    await runtime.dispose()
    throw new Error(Cause.pretty(outcome.cause))
  }
  process.env[BakedFixtureCache.BAKED_ROOT_ENV] = outcome.value.root
  process.env[BakedFixtureCache.BAKED_KEYS_ENV] = JSON.stringify(outcome.value.keys)
  return async () => {
    await runtime.runPromiseExit(BakedFixtureCache.teardownProgram(outcome.value))
    await runtime.dispose()
  }
}
