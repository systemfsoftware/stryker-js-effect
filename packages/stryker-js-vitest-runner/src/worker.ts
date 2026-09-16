import { NodeFileSystem, NodePath, NodeSocketServer } from '@effect/platform-node'
import {
  layerTraceContextServer,
  startWorkerTelemetry,
  TestRunnerRpcs,
} from '@systemfsoftware/stryker-js-plugin-interface'
import * as Cause from 'effect/Cause'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import * as Logger from 'effect/Logger'
import * as RpcSerialization from 'effect/unstable/rpc/RpcSerialization'
import * as RpcServer from 'effect/unstable/rpc/RpcServer'

import { nodeModuleLayer } from './node-module.js'
import { testRunnerHandlers } from './worker-handlers.js'

const mainLayer = (socketPath: string) =>
  RpcServer.layer(TestRunnerRpcs).pipe(
    Layer.provide(testRunnerHandlers),
    Layer.provide(RpcServer.layerProtocolSocketServer),
    Layer.provide(RpcSerialization.layerNdjson),
    Layer.provide(NodeSocketServer.layer({ path: socketPath })),
    Layer.provide(Layer.mergeAll(NodeFileSystem.layer, NodePath.layer, nodeModuleLayer)),
    Layer.provide(layerTraceContextServer),
  )

const socketPath = process.env['STRYKER_SOCKET']

if (socketPath !== undefined) {
  await startWorkerTelemetry()
  Effect.runFork(
    Layer.launch(mainLayer(socketPath)).pipe(
      Effect.provideService(Logger.LogToStderr, true),
      Effect.tapCause((cause) =>
        Effect.sync(() => {
          process.stderr.write(`test runner worker: ${Cause.pretty(cause)}\n`)
          process.exitCode = 1
        })
      ),
    ),
  )
}
