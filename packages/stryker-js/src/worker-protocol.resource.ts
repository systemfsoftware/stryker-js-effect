import * as Layer from 'effect/Layer'
import * as RpcClient from 'effect/unstable/rpc/RpcClient'
import * as RpcSerialization from 'effect/unstable/rpc/RpcSerialization'
import type * as Socket from 'effect/unstable/socket/Socket'

export const layerWorkerProtocol = (
  socket: Layer.Layer<Socket.Socket, Socket.SocketError>,
): Layer.Layer<RpcClient.Protocol, Socket.SocketError> =>
  RpcClient.layerProtocolSocket({ retryTransientErrors: false }).pipe(
    Layer.provide(socket),
    Layer.provide(RpcSerialization.layerNdjson),
  )
