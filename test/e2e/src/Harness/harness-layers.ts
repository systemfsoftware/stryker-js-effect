import { Layer } from 'effect'

import { layer as nodeServicesLayer } from '@effect/platform-node/NodeServices'
import { Readiness } from '@systemfsoftware/effect-readiness'

import { layer as fixtureCacheLayer } from './drivers/fixture-cache.js'
import { layer as guestJobLayer } from './drivers/guest-job.js'
import { layer as harnessTelemetryLayer } from './drivers/harness-telemetry.js'
import { layer as strykerCliRunnerLayer } from './drivers/stryker-cli-runner.js'

export const HarnessServicesLive = Layer.mergeAll(fixtureCacheLayer, strykerCliRunnerLayer, guestJobLayer)

export const HarnessPlatformLive = Layer.mergeAll(
  guestJobLayer,
  nodeServicesLayer,
  Readiness.NodeHostProber.layer,
  harnessTelemetryLayer,
)
