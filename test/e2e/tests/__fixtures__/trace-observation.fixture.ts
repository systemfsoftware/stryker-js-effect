import { layer as nodeFileSystemLayer } from '@effect/platform-node/NodeFileSystem'
import { Observation, RemoteObservation, TempoTraceStore } from '@systemfsoftware/trace-spec'
import { Duration, Effect, FileSystem, Layer } from 'effect'
import { FetchHttpClient } from 'effect/unstable/http'

import { tempoBaseUrl } from './tempo-endpoint.js'

export const TRACE_POLL_INTERVAL = Duration.seconds(1)
export const TRACE_SETTLE_WINDOW = Duration.seconds(20)
export const TRACE_OBSERVATION_TIMEOUT = Duration.seconds(90)

export const TraceObservationLive: Layer.Layer<Observation.Observation | FileSystem.FileSystem> = Layer.unwrap(
  Effect.gen(function*() {
    const baseUrl = yield* tempoBaseUrl
    return Layer.merge(
      Layer.provide(
        RemoteObservation.layer(TempoTraceStore.source({ baseUrl }), {
          interval: TRACE_POLL_INTERVAL,
          settle: TRACE_SETTLE_WINDOW,
          timeout: TRACE_OBSERVATION_TIMEOUT,
        }),
        FetchHttpClient.layer,
      ),
      nodeFileSystemLayer,
    )
  }).pipe(Effect.orDie),
)
