import { NodeFileSystem, NodePath, NodeSocketServer } from '@effect/platform-node'
import type { Module } from '@systemfsoftware/stryker-js-language'
import * as Cause from 'effect/Cause'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as Layer from 'effect/Layer'
import * as Logger from 'effect/Logger'
import * as Path from 'effect/Path'
import type * as Rpc from 'effect/unstable/rpc/Rpc'
import type * as RpcGroup from 'effect/unstable/rpc/RpcGroup'
import * as RpcSerialization from 'effect/unstable/rpc/RpcSerialization'
import * as RpcServer from 'effect/unstable/rpc/RpcServer'

import { nodeModuleLayer } from './node-module.js'
import { layerTraceContextServer } from './TraceContextRpc.js'
import { startWorkerTelemetry } from './WorkerTelemetry.js'

export interface StartRpcWorkerParams<Rpcs extends Rpc.Any, HE> {
  readonly rpcs: RpcGroup.RpcGroup<Rpcs>
  readonly handlers: Layer.Layer<Rpc.ToHandler<Rpcs>, HE, FileSystem.FileSystem | Path.Path | Module>
  readonly schemaServices: Layer.Layer<Rpc.ServicesServer<Rpcs>, never, never>
  readonly label: string
}

export const startRpcWorker = async <Rpcs extends Rpc.Any, HE>(
  params: StartRpcWorkerParams<Rpcs, HE>,
): Promise<void> => {
  const socketPath = process.env['STRYKER_SOCKET']
  if (socketPath === undefined) return
  const platformLayers = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer, nodeModuleLayer)
  const mainLayer = RpcServer.layer(params.rpcs).pipe(
    Layer.provide(params.handlers),
    Layer.provide(params.schemaServices),
    Layer.provide(RpcServer.layerProtocolSocketServer),
    Layer.provide(RpcSerialization.layerNdjson),
    Layer.provide(NodeSocketServer.layer({ path: socketPath })),
    Layer.provide(platformLayers),
    Layer.provide(layerTraceContextServer),
  )
  await startWorkerTelemetry()
  Effect.runFork(
    Layer.launch(mainLayer).pipe(
      Effect.provideService(Logger.LogToStderr, true),
      Effect.tapCause((cause) =>
        Effect.sync(() => {
          process.stderr.write(`${params.label}: ${Cause.pretty(cause)}\n`)
          process.exitCode = 1
        })
      ),
    ),
  )
}
