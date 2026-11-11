import { Layer } from 'effect'
import type { OtlpExporter } from 'effect/observability'

import { layerDigest, layerSecureRandom } from '@effect/platform-node/NodeCrypto'
import { layer as nodeServicesLayer } from '@effect/platform-node/NodeServices'
import { Readiness } from '@systemfsoftware/effect-readiness'
import * as TestTelemetry from '@systemfsoftware/vitest-config/telemetry'

import { BakedFixtureCache } from './fixture-cache.service.js'
import { COMPONENT_ATTRIBUTE } from './harness-telemetry.js'
import { layer as guestJobsLayer } from './microsandbox-guest-job.js'
import { layer as strykerCliRunnerLayer } from './microsandbox-stryker-cli-runner.js'

const harnessTelemetryLayer: Layer.Layer<OtlpExporter.Flusher> = TestTelemetry.layer({
  [COMPONENT_ATTRIBUTE]: 'harness',
})

export const HarnessServicesLive = Layer.mergeAll(BakedFixtureCache.layer, strykerCliRunnerLayer, guestJobsLayer)

export const HarnessPlatformLive = Layer.mergeAll(
  guestJobsLayer,
  nodeServicesLayer,
  layerSecureRandom,
  layerDigest,
  Readiness.NodeHostProber.layer,
  harnessTelemetryLayer,
)
