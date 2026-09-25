import * as Context from 'effect/Context'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import * as Match from 'effect/Match'
import * as MutableHashMap from 'effect/MutableHashMap'
import * as MutableHashSet from 'effect/MutableHashSet'
import * as Option from 'effect/Option'
import * as Ref from 'effect/Ref'
import * as RpcClient from 'effect/unstable/rpc/RpcClient'
import { RpcClientError } from 'effect/unstable/rpc/RpcClientError'
import type { FromClientEncoded, FromServerEncoded } from 'effect/unstable/rpc/RpcMessage'
import * as RpcSerialization from 'effect/unstable/rpc/RpcSerialization'
import * as Socket from 'effect/unstable/socket/Socket'

type RequestId = string | number
type ResponseHandler = (data: FromServerEncoded) => Effect.Effect<void>

const droppedConnection = RpcClientError.make({
  reason: Socket.SocketReadError.make({ cause: new Error('worker connection dropped with the request in flight') }),
})

export const layerWorkerProtocol = (
  socket: Layer.Layer<Socket.Socket, Socket.SocketError>,
): Layer.Layer<RpcClient.Protocol, Socket.SocketError> =>
  Layer.effect(
    RpcClient.Protocol,
    Effect.gen(function*() {
      const handlers = MutableHashMap.empty<number, ResponseHandler>()
      const inFlight = MutableHashMap.empty<number, MutableHashSet.MutableHashSet<RequestId>>()
      const connected = yield* Ref.make(false)

      const pendingOf = (clientId: number) =>
        Option.getOrElse(MutableHashMap.get(inFlight, clientId), () => {
          const pending = MutableHashSet.empty<RequestId>()
          MutableHashMap.set(inFlight, clientId, pending)
          return pending
        })

      const settleInFlight = Effect.forEach(
        MutableHashMap.keys(inFlight),
        (clientId) => {
          const pending = pendingOf(clientId)
          const handler = MutableHashMap.get(handlers, clientId)
          return Option.match(handler, {
            onNone: () => Effect.void,
            onSome: (write) =>
              MutableHashSet.size(pending) === 0 ? Effect.void : Effect.suspend(() => {
                MutableHashSet.clear(pending)
                return write({ _tag: 'ClientProtocolError', error: droppedConnection })
              }),
          })
        },
        { discard: true },
      )

      const hooks = Layer.succeed(RpcClient.ConnectionHooks, {
        onConnect: Ref.set(connected, true),
        onDisconnect: Ref.getAndSet(connected, false).pipe(
          Effect.flatMap((wasConnected) => wasConnected ? settleInFlight : Effect.void),
        ),
      })

      const inner = yield* RpcClient.layerProtocolSocket({ retryTransientErrors: true }).pipe(
        Layer.provide(Layer.mergeAll(socket, RpcSerialization.layerNdjson, hooks)),
        Layer.build,
        Effect.map(Context.get(RpcClient.Protocol)),
      )

      const track = (clientId: number, request: FromClientEncoded) =>
        Effect.sync(() =>
          Match.value(request).pipe(
            Match.tag('Request', ({ id }) => MutableHashSet.add(pendingOf(clientId), id)),
            Match.tag('Interrupt', ({ requestId }) => MutableHashSet.remove(pendingOf(clientId), requestId)),
            Match.orElse(() => pendingOf(clientId)),
          )
        )

      const release = (clientId: number, data: FromServerEncoded) =>
        Effect.sync(() =>
          Match.value(data).pipe(
            Match.tag('Exit', ({ requestId }) => MutableHashSet.remove(pendingOf(clientId), requestId)),
            Match.orElse(() => pendingOf(clientId)),
          )
        )

      return RpcClient.Protocol.of({
        ...inner,
        run: (clientId, handler) => {
          MutableHashMap.set(handlers, clientId, handler)
          return inner.run(clientId, (data) => release(clientId, data).pipe(Effect.andThen(handler(data))))
        },
        send: (clientId, request, transferables) =>
          track(clientId, request).pipe(Effect.andThen(inner.send(clientId, request, transferables))),
      })
    }),
  )
