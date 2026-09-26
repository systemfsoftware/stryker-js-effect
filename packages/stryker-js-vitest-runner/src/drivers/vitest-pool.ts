import * as Effect from 'effect/Effect'
import { dual } from 'effect/Function'
import * as MutableRef from 'effect/MutableRef'
import * as Option from 'effect/Option'
import * as Predicate from 'effect/Predicate'
import type { PoolOptions, PoolRunnerInitializer, PoolWorker } from 'vitest/node'
import { ThreadsPoolWorker } from 'vitest/node'

import { StandbyThreadDied, StandbyThreadStopFailed } from '../StandbyThreadsPool.schema.js'

export type StandbyThreadStage = 'spare' | 'claimed'

const BEFORE_CLAIM_TEXT = '[stryker-js-vitest-runner]: the standby worker thread died before a runner claimed it'

const AFTER_CLAIM_TEXT = '[stryker-js-vitest-runner]: the standby worker thread died after a runner claimed it'

const diedTextOf = (stage: StandbyThreadStage): string => stage === 'claimed' ? AFTER_CLAIM_TEXT : BEFORE_CLAIM_TEXT

export interface PoolThread {
  readonly worker: PoolWorker
  readonly boot: Promise<void>
  readonly died: MutableRef.MutableRef<boolean>
  readonly deathCause: MutableRef.MutableRef<Error | undefined>
  readonly stopping: MutableRef.MutableRef<boolean>
}

const errorOf = <A>(cause: A): Error | undefined => Predicate.isError(cause) ? cause : undefined

export const spawnThread = (options: PoolOptions): PoolThread => {
  const worker = new ThreadsPoolWorker(options)
  const died = MutableRef.make(false)
  const deathCause = MutableRef.make<Error | undefined>(undefined)
  const stopping = MutableRef.make(false)
  const recordDeath = (cause: Error | undefined): void => {
    MutableRef.set(deathCause, cause)
    MutableRef.set(died, true)
  }
  const guard = (): void => {
    worker.on('error', (cause) => recordDeath(errorOf(cause)))
    worker.on('exit', () => recordDeath(undefined))
  }
  const boot = worker.start().then(guard, (cause) => {
    recordDeath(errorOf(cause))
  })
  return { worker, boot, died, deathCause, stopping }
}

export const isLive = (thread: PoolThread): boolean => !MutableRef.get(thread.died)

const deathMessageOf = (thread: PoolThread, stage: StandbyThreadStage): string => {
  const cause = MutableRef.get(thread.deathCause)
  return Option.fromNullishOr(cause).pipe(
    Option.map((present) => present.message),
    Option.getOrElse(() => diedTextOf(stage)),
  )
}

const diedFailure = (thread: PoolThread, stage: StandbyThreadStage): StandbyThreadDied =>
  StandbyThreadDied.make({ cause: MutableRef.get(thread.deathCause), message: deathMessageOf(thread, stage) })

export const startThread = (thread: PoolThread): Effect.Effect<void, StandbyThreadDied> =>
  Effect.tryPromise({
    try: () => thread.boot,
    catch: () => diedFailure(thread, 'claimed'),
  }).pipe(Effect.flatMap(() => isLive(thread) ? Effect.void : Effect.fail(diedFailure(thread, 'claimed'))))

const stopFailure = (
  cause: Error | undefined,
  stage: StandbyThreadStage,
): StandbyThreadStopFailed =>
  StandbyThreadStopFailed.make({
    cause,
    message: Option.getOrElse(
      Option.map(Option.fromNullishOr(cause), (refusal) => refusal.message),
      () => diedTextOf(stage),
    ),
  })

const shouldStop = (thread: PoolThread): boolean => isLive(thread) && !MutableRef.get(thread.stopping)

const stopNow = (thread: PoolThread, stage: StandbyThreadStage): Effect.Effect<void, StandbyThreadStopFailed> => {
  MutableRef.set(thread.stopping, true)
  return Effect.tryPromise({
    try: () => thread.worker.stop(),
    catch: (cause) => stopFailure(errorOf(cause), stage),
  })
}

export const stopThread: {
  (stage: StandbyThreadStage): (thread: PoolThread) => Effect.Effect<void, StandbyThreadStopFailed>
  (thread: PoolThread, stage: StandbyThreadStage): Effect.Effect<void, StandbyThreadStopFailed>
} = dual(
  2,
  (thread: PoolThread, stage: StandbyThreadStage): Effect.Effect<void, StandbyThreadStopFailed> =>
    shouldStop(thread) ? stopNow(thread, stage) : Effect.void,
)

export interface StandbyWorkerPool {
  readonly name: string
  readonly claim: (options: PoolOptions) => Effect.Effect<PoolThread>
  readonly release: (thread: PoolThread) => Effect.Effect<void, StandbyThreadStopFailed>
}

export const standbyPoolRunner = (pool: StandbyWorkerPool): PoolRunnerInitializer => ({
  name: pool.name,
  createPoolWorker: (options) => {
    const thread = Effect.runSync(pool.claim(options))
    return {
      name: pool.name,
      on: (event, callback) => {
        thread.worker.on(event, callback)
      },
      off: (event, callback) => {
        thread.worker.off(event, callback)
      },
      send: (message) => {
        thread.worker.send(message)
      },
      deserialize: (data) => thread.worker.deserialize(data),
      start: () => Effect.runPromise(startThread(thread)),
      stop: () => Effect.runPromise(pool.release(thread)),
    }
  },
})
