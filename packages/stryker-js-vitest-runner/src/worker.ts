import * as NodeSdk from '@effect/opentelemetry/NodeSdk'
import { NodeFileSystem, NodePath, NodeSocketServer } from '@effect/platform-node'
import { layerSecureRandom as NodeCryptoLayer } from '@effect/platform-node/NodeCrypto'
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

import { testRunnerHandlers } from './TestRunnerWorker.js'
import { layer as vitestSession } from './vitest-session.js'
import { layer as vitestTestRunner } from './vitest-test-runner.js'

const workerPlatformLayer = Layer.unwrap(
  Effect.gen(function*() {
    const telemetry = yield* Worker.WorkerTelemetry
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

const vitestRunnerLayer = Layer.unwrap(
  Effect.gen(function*() {
    const options = yield* Worker.WorkerOptions
    const sandboxDirectory = yield* Config.String('STRYKER_SANDBOX_DIR')
    const input = { options, sandboxDirectory }
    return vitestTestRunner(input).pipe(Layer.provide(vitestSession(input)))
  }),
)

const servedPlatformLayer = workerPlatformLayer.pipe(Layer.provide(Worker.WorkerTelemetry.layerConfig))

const workerRootLayer = vitestRunnerLayer.pipe(
  Layer.provideMerge(Worker.WorkerOptions.layerConfig.pipe(Layer.provideMerge(servedPlatformLayer))),
)

NodeRuntime.runMain(
  Worker.workerServerLayer({
    rpcs: Plugin.TestRunnerRpcs,
    handlers: testRunnerHandlers,
    schemaServices: Layer.empty,
  }).pipe(
    Layer.provideMerge(workerRootLayer),
    Layer.provideMerge(NodeCryptoLayer),
    Layer.launch,
    Effect.provideService(Logger.LogToStderr, true),
  ),
)
