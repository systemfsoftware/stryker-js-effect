import { Layer } from 'effect'

import { layer as nodeServicesLayer } from '@effect/platform-node/NodeServices'
import { Readiness } from '@systemfsoftware/effect-readiness'

import { BakedFixtureCache } from './fixture-cache.service.js'
import { GuestJobs } from './guest-job.service.js'
import { layer as harnessTelemetryLayer } from './harness-telemetry.service.js'
import { StrykerCliRunner } from './stryker-cli-runner.service.js'

export const HarnessServicesLive = Layer.mergeAll(BakedFixtureCache.layer, StrykerCliRunner.layer, GuestJobs.layer)

export const HarnessPlatformLive = Layer.mergeAll(
  GuestJobs.layer,
  nodeServicesLayer,
  Readiness.NodeHostProber.layer,
  harnessTelemetryLayer,
)
