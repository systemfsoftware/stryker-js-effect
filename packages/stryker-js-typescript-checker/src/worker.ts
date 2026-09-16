import { NodeFileSystem, NodePath, NodeSocketServer } from '@effect/platform-node'
import {
  CheckerRpcs,
  layerTraceContextServer,
  startWorkerTelemetry,
} from '@systemfsoftware/stryker-js-plugin-interface'
import * as Cause from 'effect/Cause'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import * as Logger from 'effect/Logger'
import * as RpcSerialization from 'effect/unstable/rpc/RpcSerialization'
import * as RpcServer from 'effect/unstable/rpc/RpcServer'

import { checkerHandlers } from './worker-handlers.js'

const mainLayer = (socketPath: string) =>
  RpcServer.layer(CheckerRpcs).pipe(
    Layer.provide(checkerHandlers),
    Layer.provide(RpcServer.layerProtocolSocketServer),
    Layer.provide(RpcSerialization.layerNdjson),
    Layer.provide(NodeSocketServer.layer({ path: socketPath })),
    Layer.provide(Layer.mergeAll(NodeFileSystem.layer, NodePath.layer)),
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
          process.stderr.write(`checker worker: ${Cause.pretty(cause)}\n`)
          process.exitCode = 1
        })
      ),
    ),
  )
}
