import * as NodeSdk from '@effect/opentelemetry/NodeSdk'
import { NodeFileSystem, NodePath, NodeSocketServer } from '@effect/platform-node'
import * as NodeRuntime from '@effect/platform-node/NodeRuntime'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'
import { SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base'
import { CheckerRpcs } from '@systemfsoftware/stryker-js-plugin-interface'
import { WorkerOptions, workerServerLayer, WorkerTelemetry } from '@systemfsoftware/stryker-js-plugin-runtime'
import * as Boolean from 'effect/Boolean'
import * as Config from 'effect/Config'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import * as Logger from 'effect/Logger'

import { CheckerRuntime } from './CheckerRuntime.service.js'
import { checkerHandlers } from './CheckerWorker.service.js'

const workerPlatformLayer = Layer.unwrap(
  Effect.gen(function*() {
    const telemetry = yield* WorkerTelemetry
    const socketPath = yield* Config.String('STRYKER_SOCKET')
    return Layer.mergeAll(
      NodeSocketServer.layer({ path: socketPath }),
      NodeFileSystem.layer,
      NodePath.layer,
      Boolean.match(telemetry.enabled, {
        onTrue: () =>
          NodeSdk.layer(() => ({
            resource: { serviceName: telemetry.serviceName },
            spanProcessor: new SimpleSpanProcessor(new OTLPTraceExporter({ url: telemetry.endpoint })),
          })),
        onFalse: () => Layer.empty,
      }),
    )
  }),
)

const checkerRuntimeLayer = Layer.unwrap(
  Effect.gen(function*() {
    const options = yield* WorkerOptions
    return CheckerRuntime.layer(options)
  }),
)

const servedPlatformLayer = workerPlatformLayer.pipe(Layer.provide(WorkerTelemetry.layer))

const workerRootLayer = checkerRuntimeLayer.pipe(
  Layer.provideMerge(WorkerOptions.layer.pipe(Layer.provideMerge(servedPlatformLayer))),
)

NodeRuntime.runMain(
  workerServerLayer({
    rpcs: CheckerRpcs,
    handlers: checkerHandlers,
    schemaServices: Layer.empty,
  }).pipe(
    Layer.provideMerge(workerRootLayer),
    Layer.launch,
    Effect.provideService(Logger.LogToStderr, true),
  ),
)
