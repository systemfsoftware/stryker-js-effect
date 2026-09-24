import type * as Effect from 'effect/Effect'
import type * as Layer from 'effect/Layer'
import { type Pipeable, Prototype } from 'effect/Pipeable'
import * as Predicate from 'effect/Predicate'
import type * as RpcClient from 'effect/unstable/rpc/RpcClient'
import type * as Socket from 'effect/unstable/socket/Socket'

import type { WorkerExit } from './Worker.schema.js'

export const TypeId: unique symbol = Symbol.for('@systemfsoftware/stryker-js/SpawnedSocketWorker')
export type TypeId = typeof TypeId

const ClientLayerTypeId: unique symbol = Symbol.for('@systemfsoftware/stryker-js/SpawnedSocketWorker/clientLayer')

export interface SpawnedSocketWorker extends Pipeable {
  readonly [TypeId]: typeof TypeId
  readonly [ClientLayerTypeId]: Layer.Layer<RpcClient.Protocol, Socket.SocketError>
  readonly pid: number
  readonly exited: Effect.Effect<never, WorkerExit>
}

export const isSpawnedSocketWorker = (u: unknown): u is SpawnedSocketWorker => Predicate.hasProperty(u, TypeId)

export const make = (worker: {
  readonly pid: number
  readonly clientLayer: Layer.Layer<RpcClient.Protocol, Socket.SocketError>
  readonly exited: Effect.Effect<never, WorkerExit>
}): SpawnedSocketWorker => ({
  [TypeId]: TypeId,
  [ClientLayerTypeId]: worker.clientLayer,
  pid: worker.pid,
  exited: worker.exited,
  ...Prototype,
})

export const clientLayer = (self: SpawnedSocketWorker) => self[ClientLayerTypeId]
