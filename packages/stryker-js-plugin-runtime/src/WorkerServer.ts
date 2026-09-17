import { NodeFileSystem, NodePath, NodeSocketServer } from '@effect/platform-node'
import * as Config from 'effect/Config'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as Layer from 'effect/Layer'
import * as Path from 'effect/Path'
import type * as Rpc from 'effect/unstable/rpc/Rpc'
import type * as RpcGroup from 'effect/unstable/rpc/RpcGroup'
import * as RpcSerialization from 'effect/unstable/rpc/RpcSerialization'
import * as RpcServer from 'effect/unstable/rpc/RpcServer'

import { layerTraceContextServer } from './TraceContextRpc.js'
import { workerTelemetryLayer } from './WorkerTelemetry.js'

export interface WorkerServerParams<Rpcs extends Rpc.Any, HE> {
  readonly rpcs: RpcGroup.RpcGroup<Rpcs>
  readonly handlers: Layer.Layer<Rpc.ToHandler<Rpcs>, HE, FileSystem.FileSystem | Path.Path>
  readonly schemaServices: Layer.Layer<Rpc.ServicesServer<Rpcs>, never, never>
}

export const workerServerLayer = <Rpcs extends Rpc.Any, HE>(params: WorkerServerParams<Rpcs, HE>) =>
  Layer.unwrap(
    Effect.gen(function*() {
      const socketPath = yield* Config.string('STRYKER_SOCKET')
      return RpcServer.layer(params.rpcs).pipe(
        Layer.provide(params.handlers),
        Layer.provide(params.schemaServices),
        Layer.provide(RpcServer.layerProtocolSocketServer),
        Layer.provide(RpcSerialization.layerNdjson),
        Layer.provide(NodeSocketServer.layer({ path: socketPath })),
        Layer.provide(Layer.mergeAll(NodeFileSystem.layer, NodePath.layer)),
        Layer.provide(layerTraceContextServer),
        Layer.provideMerge(workerTelemetryLayer),
      )
    }),
  )
