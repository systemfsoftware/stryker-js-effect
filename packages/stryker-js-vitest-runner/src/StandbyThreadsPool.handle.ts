import { Handle } from '@systemfsoftware/effect-cell-types'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Predicate from 'effect/Predicate'
import type { PoolOptions, PoolWorker, ResolvedConfig } from 'vitest/node'
import { ThreadsPoolWorker } from 'vitest/node'

export const TypeId = Symbol.for('~systemfsoftware/stryker-js-vitest-runner/StandbyThreadsPool')
export type TypeId = typeof TypeId

const POOL_NAME = 'strykerThreads'

type StandbyPoolInitializer = NonNullable<ResolvedConfig['poolRunner']>

type StandbyState = 'spare' | 'claimed' | 'stopped' | 'failed'

interface SpareThread {
  readonly project: PoolOptions['project']
  state: StandbyState
}

interface StandbySlot extends SpareThread {
  readonly worker: ThreadsPoolWorker
  readonly started: Promise<void>
  failure: Option.Option<Error>
}

interface StandbySlotRegistry {
  readonly slots: StandbySlot[]
}

const StandbyThreadsPool = Handle.make<{ readonly name: string }, StandbySlotRegistry>()(TypeId)

export type StandbyThreadsPool = Handle.Of<typeof StandbyThreadsPool>

export const isStandbyThreadsPool = StandbyThreadsPool.is

export const make = (): StandbyThreadsPool => StandbyThreadsPool.make({ name: POOL_NAME }, { slots: [] })

const reusesThread = (slot: SpareThread, options: PoolOptions): boolean =>
  slot.state === 'spare' && slot.project === options.project

const spareFor = <A extends SpareThread>(
  slots: readonly A[],
  options: PoolOptions,
): Option.Option<A> => Option.fromNullishOr(slots.find((slot) => reusesThread(slot, options)))

const bootFailed = (): Error =>
  new Error('[stryker-js-vitest-runner]: the standby worker thread died before a runner claimed it')

const dieSlot = (slot: StandbySlot, failure: Error): void => {
  slot.state = 'failed'
  slot.failure = Option.some(failure)
}

const failureOf = (slot: StandbySlot): Error => Option.getOrElse(slot.failure, bootFailed)

const deathOf = <A>(cause: A): Error => Option.getOrElse(Option.liftPredicate(cause, Predicate.isError), bootFailed)

const guardSlot = (slot: StandbySlot): void => {
  slot.worker.on('error', (cause) => dieSlot(slot, deathOf(cause)))
  slot.worker.on('exit', () => dieSlot(slot, bootFailed()))
}

const spawnSlot = (registry: StandbySlotRegistry, options: PoolOptions): StandbySlot => {
  const worker = new ThreadsPoolWorker(options)
  const slot: StandbySlot = {
    project: options.project,
    worker,
    state: 'spare',
    failure: Option.none(),
    started: worker.start().then(() => guardSlot(slot), (cause) => dieSlot(slot, deathOf(cause))),
  }
  registry.slots.push(slot)
  return slot
}

const claimedSlot = (slot: StandbySlot): StandbySlot => {
  slot.state = 'claimed'
  return slot
}

const stopWorker = (slot: StandbySlot): Promise<void> =>
  slot.worker.stop().then(() => {
    slot.state = 'stopped'
  })

const stopSlot = (slot: StandbySlot): Promise<void> =>
  Match.value(slot.state).pipe(
    Match.when('spare', () => stopWorker(slot)),
    Match.when('claimed', () => stopWorker(slot)),
    Match.orElse(() => Promise.resolve()),
  )

const startSlot = (slot: StandbySlot): Promise<void> =>
  Match.value(slot.state).pipe(
    Match.when('failed', () => Promise.reject(failureOf(slot))),
    Match.orElse(() => slot.started),
  )

const poolWorkerOf = (slot: StandbySlot): PoolWorker => ({
  name: POOL_NAME,
  on: (event, callback) => slot.worker.on(event, callback),
  off: (event, callback) => slot.worker.off(event, callback),
  send: (message) => slot.worker.send(message),
  deserialize: (data) => slot.worker.deserialize(data),
  start: () => startSlot(slot),
  stop: () => stopSlot(slot),
})

const isLive = (slot: StandbySlot): boolean => slot.state === 'spare' || slot.state === 'claimed'

const pruneFinished = (registry: StandbySlotRegistry): void => {
  registry.slots.splice(0, registry.slots.length, ...registry.slots.filter(isLive))
}

const claim = (self: StandbyThreadsPool, options: PoolOptions): PoolWorker => {
  const registry = StandbyThreadsPool.slot(self)
  pruneFinished(registry)
  const claimed = Option.getOrElse(
    Option.map(spareFor(registry.slots, options), claimedSlot),
    () => claimedSlot(spawnSlot(registry, options)),
  )
  spawnSlot(registry, options)
  return poolWorkerOf(claimed)
}

export const initializer = (self: StandbyThreadsPool): StandbyPoolInitializer => ({
  name: self.name,
  createPoolWorker: (options) => claim(self, options),
})

export const dispose = (self: StandbyThreadsPool): Promise<void> =>
  Promise.all(StandbyThreadsPool.slot(self).slots.map(stopSlot)).then(() => undefined)
