import { Plugin, type Reporter } from '@systemfsoftware/stryker-js-plugin-interface'
import { Trace } from '@systemfsoftware/stryker-js-plugin-runtime'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import * as Ref from 'effect/Ref'
import type * as Scope from 'effect/Scope'
import * as RpcSerialization from 'effect/unstable/rpc/RpcSerialization'
import * as RpcServer from 'effect/unstable/rpc/RpcServer'
import * as Socket from 'effect/unstable/socket/Socket'
import * as SocketServer from 'effect/unstable/socket/SocketServer'
import { Worker } from '../../src/mod.js'

import { servingLauncher, singleConnection } from './substituted-worker.fixture.js'

export const REPORTER_WORKER_ENTRYPOINT = '/project/node_modules/@acme/stryker-reporter/dist/worker.mjs'

export const REPORTER_WORKER_PID = 4343

export interface ReporterWorkerGauge {
  readonly yielded: Ref.Ref<number>
  readonly delivered: Ref.Ref<number>
  readonly maxLag: Ref.Ref<number>
}

export interface ReporterWorkerTrace {
  readonly inits: Ref.Ref<readonly Plugin.ReporterInitOptions[]>
  readonly batches: Ref.Ref<readonly (readonly Reporter.ReporterEvent[])[]>
  readonly flushes: Ref.Ref<number>
  readonly gauge: ReporterWorkerGauge
}

export const makeReporterWorkerTrace: Effect.Effect<ReporterWorkerTrace> = Effect.gen(function*() {
  return {
    inits: yield* Ref.make<readonly Plugin.ReporterInitOptions[]>([]),
    batches: yield* Ref.make<readonly (readonly Reporter.ReporterEvent[])[]>([]),
    flushes: yield* Ref.make(0),
    gauge: {
      yielded: yield* Ref.make(0),
      delivered: yield* Ref.make(0),
      maxLag: yield* Ref.make(0),
    },
  }
})

const recordBatch = (
  trace: ReporterWorkerTrace,
  batch: readonly Reporter.ReporterEvent[],
): Effect.Effect<void> =>
  Ref.update(trace.batches, (seen) => [...seen, batch]).pipe(
    Effect.andThen(Ref.update(trace.gauge.delivered, (delivered) => delivered + batch.length)),
  )

const reporterServer = (socket: Socket.Socket, trace: ReporterWorkerTrace): Layer.Layer<never> =>
  RpcServer.layer(Plugin.ReporterRpcs).pipe(
    Layer.provide(Plugin.ReporterRpcs.toLayer({
      init: (payload) => Ref.update(trace.inits, (seen) => [...seen, payload]),
      onEventBatch: (batch: readonly Reporter.ReporterEvent[]) => recordBatch(trace, batch),
      flush: () => Ref.update(trace.flushes, (flushed) => flushed + 1),
    })),
    Layer.provide(RpcServer.layerProtocolSocketServer),
    Layer.provide(RpcSerialization.layerNdjson),
    Layer.provide(Layer.succeed(Socket.Socket, socket)),
    Layer.provide(Layer.succeed(SocketServer.SocketServer, singleConnection(socket))),
    Layer.provide(Trace.layerTraceContextServer),
  )

export interface ReporterServingLauncher {
  readonly spawns: Ref.Ref<readonly Worker.WorkerSpawnParams[]>
  readonly layer: Layer.Layer<Worker.WorkerLauncher>
}

export const reporterServingLauncher = (
  trace: ReporterWorkerTrace,
): Effect.Effect<ReporterServingLauncher, never, Scope.Scope> =>
  servingLauncher({
    pid: REPORTER_WORKER_PID,
    server: (socket) => reporterServer(socket, trace),
    clientLayer: (socket) => Worker.layerWorkerProtocol(Layer.succeed(Socket.Socket, socket)),
    exited: Effect.never,
  })
