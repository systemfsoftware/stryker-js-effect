import { Blueprint } from '@systemfsoftware/effect-cell-types'
import * as Context from 'effect/Context'
import * as Effect from 'effect/Effect'
import * as FiberSet from 'effect/FiberSet'
import * as HashMap from 'effect/HashMap'
import * as Layer from 'effect/Layer'
import * as Ref from 'effect/Ref'
import * as RpcClient from 'effect/unstable/rpc/RpcClient'
import { RpcClientError } from 'effect/unstable/rpc/RpcClientError'
import type { FromServerEncoded } from 'effect/unstable/rpc/RpcMessage'
import * as RpcSerialization from 'effect/unstable/rpc/RpcSerialization'
import * as Socket from 'effect/unstable/socket/Socket'

export const TypeId = Symbol.for('~systemfsoftware/stryker-js/WorkerProtocol')
export type TypeId = typeof TypeId

export interface WorkerProtocolSpec {
  readonly socket: Layer.Layer<Socket.Socket, Socket.SocketError>
}

type ResponseHandler = (data: FromServerEncoded) => Effect.Effect<void>

const connectionLost = RpcClientError.make({
  reason: Socket.SocketReadError.make({ cause: new Error('worker connection dropped with the request in flight') }),
})

const connectionLostMessage: FromServerEncoded = { _tag: 'ClientProtocolError', error: connectionLost }

const failInFlightRequests = Effect.fn('stryker.worker.protocol.failInFlight')(function*(
  responseHandlers: Ref.Ref<HashMap.HashMap<number, ResponseHandler>>,
) {
  const registered = yield* Ref.get(responseHandlers)
  yield* Effect.forEach(HashMap.values(registered), (write) => write(connectionLostMessage), { discard: true })
})

const makeWorkerProtocol = Effect.fn('stryker.worker.protocol.make')(function*(
  socket: Layer.Layer<Socket.Socket, Socket.SocketError>,
) {
  const responseHandlers = yield* Ref.make(HashMap.empty<number, ResponseHandler>())
  const liveConnections = yield* FiberSet.make<never, never>()

  const hooks = Layer.succeed(RpcClient.ConnectionHooks, {
    onConnect: FiberSet.run(
      liveConnections,
      Effect.never.pipe(Effect.onInterrupt(() => failInFlightRequests(responseHandlers))),
    ).pipe(Effect.asVoid),
    onDisconnect: FiberSet.clear(liveConnections),
  })

  const protocol = yield* RpcClient.layerProtocolSocket({ retryTransientErrors: true }).pipe(
    Layer.provide(Layer.mergeAll(socket, RpcSerialization.layerNdjson, hooks)),
    Layer.build,
    Effect.map(Context.get(RpcClient.Protocol)),
  )

  return RpcClient.Protocol.of({
    ...protocol,
    run: (clientId, handler) =>
      Ref.update(responseHandlers, HashMap.set(clientId, handler)).pipe(
        Effect.andThen(protocol.run(clientId, handler)),
      ),
  })
})

const WorkerProtocol = Blueprint.make<WorkerProtocolSpec>()(TypeId).steps({
  steps: {},
  targets: { layer: (spec: WorkerProtocolSpec) => Layer.effect(RpcClient.Protocol, makeWorkerProtocol(spec.socket)) },
})

export type WorkerProtocolBlueprint = Blueprint.Of<typeof WorkerProtocol>

export const layerWorkerProtocol = (
  socket: Layer.Layer<Socket.Socket, Socket.SocketError>,
): Layer.Layer<RpcClient.Protocol, Socket.SocketError> => WorkerProtocol.of({ socket }).layer
