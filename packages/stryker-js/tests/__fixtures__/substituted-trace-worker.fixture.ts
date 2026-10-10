import { Plugin } from '@systemfsoftware/stryker-js-plugin-interface'
import { Trace } from '@systemfsoftware/stryker-js-plugin-runtime'
import * as Effect from 'effect/Effect'
import type * as Headers from 'effect/http/Headers'
import * as Layer from 'effect/Layer'
import * as Ref from 'effect/Ref'
import * as RpcSerialization from 'effect/rpc/RpcSerialization'
import * as RpcServer from 'effect/rpc/RpcServer'
import type * as Scope from 'effect/Scope'
import * as Socket from 'effect/socket/Socket'
import * as SocketServer from 'effect/socket/SocketServer'

import type { Workers } from '@systemfsoftware/stryker-js-contracts'
import { WorkerHost } from '@systemfsoftware/stryker-js-worker-host'
import { servingLauncher, singleConnection } from './substituted-worker.fixture.js'

export const TRACE_WORKER_ENTRYPOINT = '/project/node_modules/@acme/stryker-reporter/dist/worker.mjs'

export const TRACE_WORKER_PID = 4545

export interface TraceWorkerRecord {
  readonly headers: Ref.Ref<Headers.Headers | undefined>
}

export const makeTraceWorkerRecord: Effect.Effect<TraceWorkerRecord> = Effect.gen(function*() {
  return { headers: yield* Ref.make<Headers.Headers | undefined>(undefined) }
})

const traceServer = (socket: Socket.Socket, record: TraceWorkerRecord): Layer.Layer<never> =>
  RpcServer.layer(Plugin.ReporterRpcs).pipe(
    Layer.provide(Plugin.ReporterRpcs.toLayer({
      init: (_payload, options) =>
        Ref.set(record.headers, options.headers).pipe(
          Effect.andThen(Trace.withLinkedSpan('worker.async', {}, Effect.void)),
        ),
      onEventBatch: () => Effect.void,
      flush: () => Effect.void,
    })),
    Layer.provide(RpcServer.layerProtocolSocketServer),
    Layer.provide(RpcSerialization.layerNdjson),
    Layer.provide(Layer.succeed(Socket.Socket, socket)),
    Layer.provide(Layer.succeed(SocketServer.SocketServer, singleConnection(socket))),
    Layer.provide(Trace.layerTraceContextServer),
  )

export const traceServingLauncher = (
  record: TraceWorkerRecord,
): Effect.Effect<Layer.Layer<Workers.WorkerLauncher>, never, Scope.Scope> =>
  Effect.map(
    servingLauncher({
      pid: TRACE_WORKER_PID,
      server: (socket) => traceServer(socket, record),
      clientLayer: (socket) => WorkerHost.layerWorkerProtocol(Layer.succeed(Socket.Socket, socket)),
      exited: Effect.never,
    }),
    (launcher) => launcher.layer,
  )
