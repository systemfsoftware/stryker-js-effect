import { ChildProcessCrashedError, OutOfMemoryError, WorkerLauncher } from '@systemfsoftware/stryker-js-engine'
import type { SpawnedSocketWorker, WorkerExit, WorkerSpawnParams } from '@systemfsoftware/stryker-js-engine'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import * as Match from 'effect/Match'
import * as Predicate from 'effect/Predicate'
import * as Queue from 'effect/Queue'
import * as Ref from 'effect/Ref'
import * as Schema from 'effect/Schema'
import type * as Scope from 'effect/Scope'
import * as Rpc from 'effect/unstable/rpc/Rpc'
import * as RpcClient from 'effect/unstable/rpc/RpcClient'
import * as RpcGroup from 'effect/unstable/rpc/RpcGroup'
import * as RpcSerialization from 'effect/unstable/rpc/RpcSerialization'
import * as RpcServer from 'effect/unstable/rpc/RpcServer'
import * as Socket from 'effect/unstable/socket/Socket'
import * as SocketServer from 'effect/unstable/socket/SocketServer'

export const WORKER_PID = 4242

export const WORKER_ENTRYPOINT = '/project/node_modules/@acme/stryker-runner/dist/worker.mjs'

export const PingRpcs = RpcGroup.make(
  Rpc.make('ping', { payload: { message: Schema.String }, success: Schema.String }),
)

const PingHandlers = PingRpcs.toLayer({
  ping: ({ message }: { readonly message: string }) => Effect.succeed(`pong:${message}`),
})

export type ChildBehaviour = 'acceptsConnection' | 'neverBinds' | 'crashes' | 'runsOutOfMemory'

const asBytes = (frame: Uint8Array | string): Uint8Array =>
  Match.value(frame).pipe(
    Match.when(Predicate.isString, (text) => new TextEncoder().encode(text)),
    Match.orElse((bytes) => bytes),
  )

const memorySocket = (
  inbox: Queue.Queue<Uint8Array>,
  outbox: Queue.Queue<Uint8Array>,
): Socket.Socket =>
  Socket.make({
    runRaw: (handler) =>
      Queue.take(inbox).pipe(
        Effect.flatMap((chunk) => {
          const running = handler(chunk)
          if (running === undefined) {
            return Effect.void
          }
          return running
        }),
        Effect.forever,
      ),
    writer: Effect.succeed((chunk) =>
      Match.value(chunk).pipe(
        Match.when(Socket.isCloseEvent, () => Effect.void),
        Match.orElse((frame) => Queue.offer(outbox, asBytes(frame))),
      )
    ),
  })

export const memorySocketPair: Effect.Effect<readonly [Socket.Socket, Socket.Socket]> = Effect.gen(function*() {
  const hostToWorker = yield* Queue.unbounded<Uint8Array>()
  const workerToHost = yield* Queue.unbounded<Uint8Array>()
  return [memorySocket(workerToHost, hostToWorker), memorySocket(hostToWorker, workerToHost)] as const
})

export const singleConnection = (socket: Socket.Socket): SocketServer.SocketServer['Service'] => ({
  address: { _tag: 'UnixAddress', path: 'substituted-worker' },
  run: <R, E, A>(handler: (socket: Socket.Socket) => Effect.Effect<A, E, R>) =>
    handler(socket).pipe(Effect.orDie, Effect.andThen(Effect.never)),
})

const workerServer = (socket: Socket.Socket): Layer.Layer<never> =>
  RpcServer.layer(PingRpcs).pipe(
    Layer.provide(PingHandlers),
    Layer.provide(RpcServer.layerProtocolSocketServer),
    Layer.provide(RpcSerialization.layerNdjson),
    Layer.provide(Layer.succeed(Socket.Socket, socket)),
    Layer.provide(Layer.succeed(SocketServer.SocketServer, singleConnection(socket))),
  )

const unboundAddress = (): Socket.SocketError =>
  Socket.SocketError.make({
    reason: Socket.SocketOpenError.make({ kind: 'Unknown', cause: 'the substituted worker never bound its address' }),
  })

const clientProtocol = (
  behaviour: ChildBehaviour,
  socket: Socket.Socket,
): Layer.Layer<RpcClient.Protocol, Socket.SocketError> => {
  if (behaviour !== 'acceptsConnection') {
    return Layer.effect(RpcClient.Protocol)(Effect.fail(unboundAddress()))
  }
  return RpcClient.layerProtocolSocket({ retryTransientErrors: true }).pipe(
    Layer.provide(Layer.succeed(Socket.Socket, socket)),
    Layer.provide(RpcSerialization.layerNdjson),
  )
}

const exitOf = (behaviour: ChildBehaviour): Effect.Effect<never, WorkerExit> => {
  if (behaviour === 'crashes') {
    return Effect.fail(
      ChildProcessCrashedError.make({
        pid: WORKER_PID,
        exit: { _tag: 'Code', code: 9 },
        cause: 'the substituted worker died during boot',
      }),
    )
  }
  if (behaviour === 'runsOutOfMemory') {
    return Effect.fail(OutOfMemoryError.make({ pid: WORKER_PID, exitCode: 137 }))
  }
  return Effect.never
}

export interface SubstitutedLauncher {
  readonly spawns: Ref.Ref<readonly WorkerSpawnParams[]>
  readonly layer: Layer.Layer<WorkerLauncher>
}

export interface ServingLauncherParams {
  readonly pid: number
  readonly server: ((serverSocket: Socket.Socket) => Layer.Layer<never>) | undefined
  readonly clientLayer: (clientSocket: Socket.Socket) => Layer.Layer<RpcClient.Protocol, Socket.SocketError>
  readonly exited: Effect.Effect<never, WorkerExit>
}

export const servingLauncher = (
  params: ServingLauncherParams,
): Effect.Effect<SubstitutedLauncher, never, Scope.Scope> =>
  Effect.gen(function*() {
    const spawns = yield* Ref.make<readonly WorkerSpawnParams[]>([])
    const [clientSocket, serverSocket] = yield* memorySocketPair

    const spawn = (workerParams: WorkerSpawnParams): Effect.Effect<SpawnedSocketWorker, never, Scope.Scope> =>
      Effect.gen(function*() {
        yield* Ref.update(spawns, (recorded) => [...recorded, workerParams])
        if (params.server !== undefined) {
          yield* Effect.forkScoped(Layer.launch(params.server(serverSocket)))
        }
        return { pid: params.pid, clientLayer: params.clientLayer(clientSocket), exited: params.exited }
      })

    return { spawns, layer: Layer.succeed(WorkerLauncher, { spawn }) }
  })

export const substitutedLauncher = (
  behaviour: ChildBehaviour,
): Effect.Effect<SubstitutedLauncher, never, Scope.Scope> =>
  servingLauncher({
    pid: WORKER_PID,
    server: Match.value(behaviour).pipe(
      Match.when('acceptsConnection', () => workerServer),
      Match.orElse((): undefined => undefined),
    ),
    clientLayer: (socket) => clientProtocol(behaviour, socket),
    exited: exitOf(behaviour),
  })
