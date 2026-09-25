import { Handle } from '@systemfsoftware/effect-cell-types'
import type * as Effect from 'effect/Effect'
import type * as Layer from 'effect/Layer'
import type * as RpcClient from 'effect/unstable/rpc/RpcClient'
import type * as Socket from 'effect/unstable/socket/Socket'

import type { WorkerExit } from './Worker.schema.js'

export const TypeId: unique symbol = Symbol.for('~systemfsoftware/stryker-js/SpawnedSocketWorker')
export type TypeId = typeof TypeId

interface SpawnedSocketWorkerSlot {
  readonly clientLayer: Layer.Layer<RpcClient.Protocol, Socket.SocketError>
}

const SpawnedSocketWorker = Handle.make<
  { readonly pid: number; readonly exited: Effect.Effect<never, WorkerExit> },
  SpawnedSocketWorkerSlot
>()(TypeId)

export type SpawnedSocketWorker = Handle.Of<typeof SpawnedSocketWorker>

export const isSpawnedSocketWorker = SpawnedSocketWorker.is

export const make = (worker: {
  readonly pid: number
  readonly clientLayer: Layer.Layer<RpcClient.Protocol, Socket.SocketError>
  readonly exited: Effect.Effect<never, WorkerExit>
}): SpawnedSocketWorker =>
  SpawnedSocketWorker.make({ pid: worker.pid, exited: worker.exited }, { clientLayer: worker.clientLayer })

export const clientLayer = (self: SpawnedSocketWorker) => SpawnedSocketWorker.slot(self).clientLayer
