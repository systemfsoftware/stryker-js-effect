import { Handle } from '@systemfsoftware/effect-cell-types'
import * as Boolean from 'effect/Boolean'
import * as Effect from 'effect/Effect'
import * as Exit from 'effect/Exit'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as Scope from 'effect/Scope'
import * as SynchronizedRef from 'effect/SynchronizedRef'
import type { PoolOptions, ResolvedConfig } from 'vitest/node'

import {
  isLive,
  type PoolThread,
  spawnThread,
  standbyPoolRunner,
  type StandbyThreadStage,
  stopThread,
} from './drivers/vitest-pool.js'
import { type StandbyThreadStopFailed } from './StandbyThreadsPool.schema.js'

export const TypeId = Symbol.for('~systemfsoftware/stryker-js-vitest-runner/StandbyThreadsPool')
export type TypeId = typeof TypeId

const POOL_NAME = 'strykerThreads'

type StandbyPoolInitializer = NonNullable<ResolvedConfig['poolRunner']>

type StandbyThreadState = 'spare' | 'claimed' | 'stopped'

interface ThreadLaunch {
  readonly project: PoolOptions['project']
  readonly env: PoolOptions['env']
  readonly execArgv: PoolOptions['execArgv']
}

interface StandbySlot {
  readonly launch: ThreadLaunch
  readonly thread: PoolThread
  readonly state: StandbyThreadState
}

interface StandbyPool {
  readonly slots: SynchronizedRef.SynchronizedRef<ReadonlyArray<StandbySlot>>
  readonly scope: Scope.Closeable
}

const StandbyThreadsPool = Handle.make<{ readonly name: string }, StandbyPool>()(TypeId)

export type StandbyThreadsPool = Handle.Of<typeof StandbyThreadsPool>

export const isStandbyThreadsPool = StandbyThreadsPool.is

const launchOf = (options: PoolOptions): ThreadLaunch => ({
  project: options.project,
  env: { ...options.env },
  execArgv: [...options.execArgv],
})

const sameEnv = (left: PoolOptions['env'], right: PoolOptions['env']): boolean => {
  const names = Object.keys(left)
  return names.length === Object.keys(right).length && names.every((name) => left[name] === right[name])
}

const sameExecArgv = (left: PoolOptions['execArgv'], right: PoolOptions['execArgv']): boolean =>
  left.length === right.length && left.every((arg, index) => arg === right[index])

const sameLaunchOptions = (launch: ThreadLaunch, options: PoolOptions): boolean =>
  sameEnv(launch.env, options.env) && sameExecArgv(launch.execArgv, options.execArgv)

const sameThreadRequest = (launch: ThreadLaunch, options: PoolOptions): boolean =>
  launch.project === options.project && sameLaunchOptions(launch, options)

const spareAndLive = (slot: StandbySlot): boolean => slot.state === 'spare' && isLive(slot.thread)

const keepsSlot = (slot: StandbySlot): boolean =>
  Match.value(slot.state).pipe(Match.when('stopped', () => false), Match.orElse(() => isLive(slot.thread)))

const reusesThread = (slot: StandbySlot, options: PoolOptions): boolean =>
  spareAndLive(slot) && sameThreadRequest(slot.launch, options)

const spareFor = (slots: ReadonlyArray<StandbySlot>, options: PoolOptions): Option.Option<StandbySlot> =>
  Option.fromNullishOr(slots.find((slot) => reusesThread(slot, options)))

const claimedOf = (slot: StandbySlot): StandbySlot => ({ ...slot, state: 'claimed' })

const stoppedOf = (slot: StandbySlot): StandbySlot => ({ ...slot, state: 'stopped' })

const standbyStage = (state: StandbyThreadState): StandbyThreadStage =>
  Match.value(state).pipe(
    Match.when('claimed', (): StandbyThreadStage => 'claimed'),
    Match.orElse((): StandbyThreadStage => 'spare'),
  )

export const make = Effect.fn('vitest.standby_pool.make')(function*() {
  const slots = yield* SynchronizedRef.make<ReadonlyArray<StandbySlot>>([])
  const lifetime = yield* Scope.Scope
  const scope = yield* Scope.fork(lifetime)
  return StandbyThreadsPool.make({ name: POOL_NAME }, { slots, scope })
})

const acquireSlot = (
  pool: StandbyPool,
  options: PoolOptions,
  state: StandbyThreadState,
): Effect.Effect<StandbySlot> =>
  Effect.acquireRelease(
    Effect.sync(() => spawnThread(options)),
    (thread) => stopThread(thread, standbyStage(state)).pipe(Effect.ignore),
  ).pipe(
    Effect.map((thread) => ({ launch: launchOf(options), thread, state })),
    Scope.provide(pool.scope),
  )

const registerSlot = (pool: StandbyPool, slot: StandbySlot): Effect.Effect<StandbySlot> =>
  Effect.as(SynchronizedRef.update(pool.slots, (slots) => [...slots, slot]), slot)

const claimedSlotOf = (
  pool: StandbyPool,
  options: PoolOptions,
): Effect.Effect<StandbySlot> =>
  Effect.flatMap(acquireSlot(pool, options, 'claimed'), (slot) => registerSlot(pool, slot))

export const claim = Effect.fn('vitest.standby_pool.claim')(function*(
  self: StandbyThreadsPool,
  options: PoolOptions,
) {
  const pool = StandbyThreadsPool.slot(self)
  const reused = yield* SynchronizedRef.modify(pool.slots, (slots) => {
    const live = slots.filter(keepsSlot)
    const spare = spareFor(live, options)
    return Option.match(spare, {
      onNone: () => [Option.none<StandbySlot>(), live] as const,
      onSome: (slot) => {
        const claimed = claimedOf(slot)
        return [Option.some(claimed), live.map((candidate) => (candidate === slot ? claimed : candidate))] as const
      },
    })
  })
  const claimed = yield* Option.match(reused, {
    onSome: Effect.succeed,
    onNone: () => claimedSlotOf(pool, options),
  })
  yield* Effect.flatMap(acquireSlot(pool, options, 'spare'), (slot) => registerSlot(pool, slot))
  return claimed.thread
})

export const release = Effect.fn('vitest.standby_pool.release')(function*(
  self: StandbyThreadsPool,
  thread: PoolThread,
) {
  const pool = StandbyThreadsPool.slot(self)
  yield* SynchronizedRef.update(
    pool.slots,
    (slots) =>
      slots.map((slot) =>
        Boolean.match(slot.thread === thread, { onTrue: () => stoppedOf(slot), onFalse: () => slot })
      ),
  )
  return yield* stopThread(thread, 'claimed')
})

const firstFailureOf = (
  outcomes: ReadonlyArray<Result.Result<void, StandbyThreadStopFailed>>,
): Effect.Effect<void, StandbyThreadStopFailed> =>
  Option.match(
    Option.map(Option.fromNullishOr(outcomes.find(Result.isFailure)), (failed) => failed.failure),
    { onNone: () => Effect.void, onSome: (failure) => Effect.fail(failure) },
  )

export const dispose = Effect.fn('vitest.standby_pool.dispose')(function*(self: StandbyThreadsPool) {
  const pool = StandbyThreadsPool.slot(self)
  const slots = yield* SynchronizedRef.get(pool.slots)
  const outcomes = yield* Effect.forEach(
    slots,
    (slot) => stopThread(slot.thread, standbyStage(slot.state)).pipe(Effect.result),
    { concurrency: 'unbounded' },
  )
  yield* SynchronizedRef.update(pool.slots, (current) => current.map(stoppedOf))
  yield* Scope.close(pool.scope, Exit.void).pipe(Effect.orDie)
  return yield* firstFailureOf(outcomes)
})

export const initializer = (self: StandbyThreadsPool): StandbyPoolInitializer =>
  standbyPoolRunner({
    name: self.name,
    claim: (options) => claim(self, options),
    release: (thread) => release(self, thread),
  })
