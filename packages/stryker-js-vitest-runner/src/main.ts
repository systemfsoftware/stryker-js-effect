import * as NodeSdk from '@effect/opentelemetry/NodeSdk'
import { NodeFileSystem, NodePath, NodeSocketServer } from '@effect/platform-node'
import { layer as NodeCryptoLayer } from '@effect/platform-node/NodeCrypto'
import * as NodeRuntime from '@effect/platform-node/NodeRuntime'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'
import { SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base'
import { TestRunnerRpcs } from '@systemfsoftware/stryker-js-plugin-interface'
import { WorkerOptions, workerServerLayer, WorkerTelemetry } from '@systemfsoftware/stryker-js-plugin-runtime'
import * as Boolean from 'effect/Boolean'
import * as Config from 'effect/Config'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import * as Logger from 'effect/Logger'

import { testRunnerHandlers } from './TestRunnerWorker.service.js'
import { layer as vitestRunner } from './VitestRunner.service.js'

const otlpTelemetryLayer = (serviceName: string, endpoint: string) =>
  NodeSdk.layer(() => ({
    resource: { serviceName },
    spanProcessor: new SimpleSpanProcessor(new OTLPTraceExporter({ url: endpoint })),
  }))

const workerPlatformLayer = Layer.unwrap(
  Effect.gen(function*() {
    const telemetry = yield* WorkerTelemetry
    const socketPath = yield* Config.String('STRYKER_SOCKET')
    return Layer.mergeAll(
      NodeSocketServer.layer({ path: socketPath }),
      NodeFileSystem.layer,
      NodePath.layer,
      Boolean.match(telemetry.enabled, {
        onTrue: () => otlpTelemetryLayer(telemetry.serviceName, telemetry.endpoint),
        onFalse: () => Layer.empty,
      }),
    )
  }),
)

const vitestRunnerLayer = Layer.unwrap(
  Effect.gen(function*() {
    const options = yield* WorkerOptions
    const sandboxDirectory = yield* Config.String('STRYKER_SANDBOX_DIR')
    return vitestRunner({ options, sandboxDirectory })
  }),
)

const servedPlatformLayer = workerPlatformLayer.pipe(Layer.provide(WorkerTelemetry.layer))

const workerRootLayer = vitestRunnerLayer.pipe(
  Layer.provideMerge(WorkerOptions.layer.pipe(Layer.provideMerge(servedPlatformLayer))),
)

NodeRuntime.runMain(
  workerServerLayer({
    rpcs: TestRunnerRpcs,
    handlers: testRunnerHandlers,
    schemaServices: Layer.empty,
  }).pipe(
    Layer.provideMerge(workerRootLayer),
    Layer.provideMerge(NodeCryptoLayer),
    Layer.launch,
    Effect.provideService(Logger.LogToStderr, true),
  ),
)
