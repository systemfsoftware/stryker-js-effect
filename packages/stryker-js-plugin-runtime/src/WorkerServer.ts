import { NodeFileSystem, NodePath, NodeSocketServer } from '@effect/platform-node'
import * as Config from 'effect/Config'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as Layer from 'effect/Layer'
import * as Match from 'effect/Match'
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
      const socketPath = yield* Config.String('STRYKER_SOCKET')
      const restrictSocket = NodeSocketServer.layer({ path: socketPath }).pipe(
        Layer.tap(() =>
          Match.value(socketPath.startsWith('\\\\.\\pipe\\')).pipe(
            Match.when(true, () => Effect.void),
            Match.orElse(() =>
              Effect.gen(function*() {
                const fs = yield* FileSystem.FileSystem
                yield* fs.chmod(socketPath, 0o600)
              })
            ),
          )
        ),
      )
      return RpcServer.layer(params.rpcs).pipe(
        Layer.provide(params.handlers),
        Layer.provide(params.schemaServices),
        Layer.provide(RpcServer.layerProtocolSocketServer),
        Layer.provide(RpcSerialization.layerNdjson),
        Layer.provide(restrictSocket),
        Layer.provide(Layer.mergeAll(NodeFileSystem.layer, NodePath.layer)),
        Layer.provide(layerTraceContextServer),
        Layer.provideMerge(workerTelemetryLayer),
      )
    }),
  )
