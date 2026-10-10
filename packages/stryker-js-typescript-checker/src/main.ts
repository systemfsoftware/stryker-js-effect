import * as NodeSdk from '@effect/opentelemetry/NodeSdk'
import { NodeFileSystem, NodePath, NodeSocketServer } from '@effect/platform-node'
import * as NodeChildProcessSpawner from '@effect/platform-node-shared/NodeChildProcessSpawner'
import * as NodeRuntime from '@effect/platform-node/NodeRuntime'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'
import { SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base'
import { Plugin } from '@systemfsoftware/stryker-js-plugin-interface'
import { Worker } from '@systemfsoftware/stryker-js-plugin-runtime'
import * as Boolean from 'effect/Boolean'
import * as Config from 'effect/Config'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import * as Logger from 'effect/Logger'

import { layer as checkerRuntime } from './drivers/checker-runtime.js'
import { checkerHandlers } from './drivers/checker-worker.js'

const workerPlatformLayer = Layer.unwrap(
  Effect.gen(function*() {
    const telemetry = yield* Worker.WorkerTelemetry
    const socketPath = yield* Config.String('STRYKER_SOCKET')
    const fileSystemAndPath = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer)
    return Layer.mergeAll(
      NodeSocketServer.layer({ path: socketPath }),
      NodeFileSystem.layer,
      NodePath.layer,
      NodeChildProcessSpawner.layer.pipe(Layer.provide(fileSystemAndPath)),
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
    const options = yield* Worker.WorkerOptions
    return checkerRuntime(options)
  }),
)

const servedPlatformLayer = workerPlatformLayer.pipe(Layer.provide(Worker.workerTelemetryLayer))

const workerRootLayer = checkerRuntimeLayer.pipe(
  Layer.provideMerge(Worker.workerOptionsLayer.pipe(Layer.provideMerge(servedPlatformLayer))),
)

NodeRuntime.runMain(
  Worker.workerServerLayer({
    rpcs: Plugin.CheckerRpcs,
    handlers: checkerHandlers,
    schemaServices: Layer.empty,
  }).pipe(
    Layer.provideMerge(workerRootLayer),
    Layer.launch,
    Effect.provideService(Logger.LogToStderr, true),
  ),
)
