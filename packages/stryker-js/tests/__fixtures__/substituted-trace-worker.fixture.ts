import { Worker } from '@systemfsoftware/stryker-js'
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

import { LinkedWork } from './declared-spans.fixture.js'
import { servingLauncher, singleConnection } from './substituted-worker.fixture.js'

export const TRACE_WORKER_ENTRYPOINT = '/project/node_modules/@acme/stryker-reporter/dist/worker.mjs'

export const TRACE_WORKER_PID = 4545

const LINKED_WORK_SPAN = LinkedWork.name

export interface TraceWorkerRecord {
  readonly headers: Ref.Ref<Headers.Headers | undefined>
  /** The trace the linked work runs in, read from the span current inside that work. */
  readonly linkedWorkTrace: { traceId: string | undefined }
}

export const makeTraceWorkerRecord: Effect.Effect<TraceWorkerRecord> = Effect.gen(function*() {
  return { headers: yield* Ref.make<Headers.Headers | undefined>(undefined), linkedWorkTrace: { traceId: undefined } }
})

/** Linked work that reads the span it runs under, as a plugin's own spans would nest beneath it. */
const linkedWork = (record: TraceWorkerRecord) =>
  Trace.withLinkedSpan(
    LINKED_WORK_SPAN,
    {},
    Effect.flatMap(Effect.orDie(Effect.currentSpan), (span) =>
      Effect.sync(() => {
        record.linkedWorkTrace.traceId = span.traceId
      })),
  )

const traceServer = (socket: Socket.Socket, record: TraceWorkerRecord): Layer.Layer<never> =>
  RpcServer.layer(Plugin.ReporterRpcs).pipe(
    Layer.provide(Plugin.ReporterRpcs.toLayer({
      init: (_payload, options) =>
        Ref.set(record.headers, options.headers).pipe(
          Effect.andThen(linkedWork(record)),
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
): Effect.Effect<Layer.Layer<Worker.WorkerLauncher>, never, Scope.Scope> =>
  Effect.map(
    servingLauncher({
      pid: TRACE_WORKER_PID,
      server: (socket) => traceServer(socket, record),
      clientLayer: (socket) => Worker.layerWorkerProtocol(Layer.succeed(Socket.Socket, socket)),
      exited: Effect.never,
    }),
    (launcher) => launcher.layer,
  )
