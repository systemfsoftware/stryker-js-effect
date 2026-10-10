import { Blueprint } from '@systemfsoftware/effect-cell-types'
import { SpanTaxonomy } from '@systemfsoftware/stryker-js-cli-contract'
import * as Boolean from 'effect/Boolean'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as Layer from 'effect/Layer'
import * as Match from 'effect/Match'
import * as NetAddress from 'effect/net/NetAddress'
import type { PlatformError } from 'effect/PlatformError'
import type * as Rpc from 'effect/rpc/Rpc'
import type * as RpcGroup from 'effect/rpc/RpcGroup'
import * as RpcSerialization from 'effect/rpc/RpcSerialization'
import * as RpcServer from 'effect/rpc/RpcServer'
import * as SocketServer from 'effect/socket/SocketServer'

import type { Trace } from '@systemfsoftware/stryker-js-plugin-interface'

import { layerTraceContextServer } from './drivers/trace-context-rpc.js'

const traceContextServer: Layer.Layer<Trace.TraceContextMiddleware> = layerTraceContextServer

const NAMED_PIPE_PREFIX = '\\\\.\\pipe\\'

const restrictSocket = Effect.fn(SpanTaxonomy.Spans.restrictSocket.name)(function*(address: NetAddress.SocketAddress) {
  yield* Match.value(address).pipe(
    Match.tag('UnixPathAddress', ({ path }) =>
      Boolean.match(path.startsWith(NAMED_PIPE_PREFIX), {
        onTrue: () => Effect.void,
        onFalse: () => Effect.flatMap(FileSystem.FileSystem, (fs) => fs.chmod(path, 0o600)),
      })),
    Match.orElse(() => Effect.void),
  )
})

const restrictedSocket: Layer.Layer<
  never,
  PlatformError,
  SocketServer.SocketServer | FileSystem.FileSystem
> = Layer.effectDiscard(
  Effect.flatMap(SocketServer.SocketServer, (socket) => restrictSocket(socket.address)),
)

export interface WorkerServerParams<Rpcs extends Rpc.Any, HE, R = never> {
  readonly rpcs: RpcGroup.RpcGroup<Rpcs>
  readonly handlers: Layer.Layer<Rpc.ToHandler<Rpcs>, HE, R>
  readonly schemaServices: Layer.Layer<Rpc.ServicesServer<Rpcs>, never, never>
}

export const TypeId = Symbol.for('~systemfsoftware/stryker-js-plugin-runtime/WorkerServer')
export type TypeId = typeof TypeId

const workerServerLayerOf = <Rpcs extends Rpc.Any, HE, R>(params: WorkerServerParams<Rpcs, HE, R>) =>
  restrictedSocket.pipe(
    Layer.flatMap(() =>
      RpcServer.layer(params.rpcs).pipe(
        Layer.provide(params.handlers),
        Layer.provide(params.schemaServices),
        Layer.provide(RpcServer.layerProtocolSocketServer),
        Layer.provide(RpcSerialization.layerNdjson),
        Layer.provide(traceContextServer),
      )
    ),
  )

const WorkerServers = Blueprint.make<WorkerServerParams<Rpc.Any, never, never>>()(TypeId).steps({
  steps: {},
  targets: { layer: workerServerLayerOf },
})

export const isWorkerServer = WorkerServers.is

export const workerServerLayer = workerServerLayerOf
