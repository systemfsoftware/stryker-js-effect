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
  readonly env: PoolOptions['env']
  readonly execArgv: PoolOptions['execArgv']
  state: StandbyState
}

interface StandbySlot extends SpareThread {
  readonly worker: PoolWorker
  readonly started: Promise<void>
  failure: Option.Option<Error>
}

interface StandbySlotRegistry {
  readonly slots: StandbySlot[]
  readonly spawn: SpawnWorker
}

export type SpawnWorker = (options: PoolOptions) => PoolWorker

const StandbyThreadsPool = Handle.make<{ readonly name: string }, StandbySlotRegistry>()(TypeId)

export type StandbyThreadsPool = Handle.Of<typeof StandbyThreadsPool>

export const isStandbyThreadsPool = StandbyThreadsPool.is

const spawnThreadsPoolWorker: SpawnWorker = (options) => new ThreadsPoolWorker(options)

export const make = (spawn: SpawnWorker = spawnThreadsPoolWorker): StandbyThreadsPool =>
  StandbyThreadsPool.make({ name: POOL_NAME }, { slots: [], spawn })

const sameEnv = (left: PoolOptions['env'], right: PoolOptions['env']): boolean => {
  const names = Object.keys(left)
  return names.length === Object.keys(right).length && names.every((name) => left[name] === right[name])
}

const sameExecArgv = (left: PoolOptions['execArgv'], right: PoolOptions['execArgv']): boolean =>
  left.length === right.length && left.every((arg, index) => arg === right[index])

const sameLaunchOptions = (slot: SpareThread, options: PoolOptions): boolean =>
  sameEnv(slot.env, options.env) && sameExecArgv(slot.execArgv, options.execArgv)

const sameSpareRequest = (slot: SpareThread, options: PoolOptions): boolean =>
  slot.project === options.project && sameLaunchOptions(slot, options)

const reusesThread = (slot: SpareThread, options: PoolOptions): boolean =>
  slot.state === 'spare' && sameSpareRequest(slot, options)

const spareFor = <A extends SpareThread>(
  slots: readonly A[],
  options: PoolOptions,
): Option.Option<A> => Option.fromNullishOr(slots.find((slot) => reusesThread(slot, options)))

const bootFailed = (): Error =>
  new Error('[stryker-js-vitest-runner]: the standby worker thread died before a runner claimed it')

const deathFailure = (slot: SpareThread): Error =>
  slot.state === 'claimed'
    ? new Error('[stryker-js-vitest-runner]: the standby worker thread died after a runner claimed it')
    : bootFailed()

const dieSlot = (slot: StandbySlot, failure: Error): void => {
  slot.state = 'failed'
  slot.failure = Option.some(failure)
}

const failureOf = (slot: StandbySlot): Error => Option.getOrElse(slot.failure, bootFailed)

const deathOf = <A>(slot: SpareThread, cause: A): Error =>
  Option.getOrElse(Option.liftPredicate(cause, Predicate.isError), () => deathFailure(slot))

const guardSlot = (slot: StandbySlot): void => {
  slot.worker.on('error', (cause) => dieSlot(slot, deathOf(slot, cause)))
  slot.worker.on('exit', () => dieSlot(slot, deathFailure(slot)))
}

const spawnSlot = (registry: StandbySlotRegistry, options: PoolOptions): StandbySlot => {
  const worker = registry.spawn(options)
  const slot: StandbySlot = {
    project: options.project,
    env: { ...options.env },
    execArgv: [...options.execArgv],
    worker,
    state: 'spare',
    failure: Option.none(),
    started: worker.start().then(() => guardSlot(slot), (cause) => dieSlot(slot, deathOf(slot, cause))),
  }
  registry.slots.push(slot)
  return slot
}

const claimedSlot = (slot: StandbySlot): StandbySlot => {
  slot.state = 'claimed'
  return slot
}

const stopWorker = (slot: StandbySlot): Promise<void> =>
  slot.worker.stop().then(
    () => {
      slot.state = 'stopped'
    },
    (cause) => {
      const failure = deathOf(slot, cause)
      dieSlot(slot, failure)
      return Promise.reject(failure)
    },
  )

const stopSlot = (slot: StandbySlot): Promise<void> =>
  Match.value(slot.state).pipe(
    Match.when('spare', () => stopWorker(slot)),
    Match.when('claimed', () => stopWorker(slot)),
    Match.orElse(() => Promise.resolve()),
  )

const startSlot = (slot: StandbySlot): Promise<void> =>
  Match.value(slot.state).pipe(
    Match.when('failed', () => Promise.reject(failureOf(slot))),
    Match.orElse(() =>
      slot.started.then(() => (slot.state === 'failed' ? Promise.reject(failureOf(slot)) : undefined))
    ),
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

const failedStopOf = (
  slots: readonly StandbySlot[],
  results: readonly PromiseSettledResult<void>[],
): Option.Option<StandbySlot> =>
  Option.fromNullishOr(slots.find((_slot, index) => results[index].status === 'rejected'))

export const dispose = (self: StandbyThreadsPool): Promise<void> => {
  const slots = [...StandbyThreadsPool.slot(self).slots]
  return Promise.allSettled(slots.map(stopSlot)).then((results) =>
    Option.match(failedStopOf(slots, results), {
      onNone: () => undefined,
      onSome: (slot) => Promise.reject(failureOf(slot)),
    })
  )
}

if (import.meta.vitest !== void 0) {
  const { it } = await import('@systemfsoftware/vitest')
  const { Schema: S } = await import('effect')
  const Effect = await import('effect/Effect')
  const { createVitest } = await import('vitest/node')

  interface VitestScratch {
    readonly project: PoolOptions['project']
    readonly distPath: string
  }

  const scratchVitest = (): Promise<VitestScratch> =>
    createVitest({ config: false, watch: false }).then((instance) => {
      const scratch: VitestScratch = { project: instance.getRootProject(), distPath: instance.distPath }
      return instance.close().then(() => scratch)
    })

  const alpha = await scratchVitest()
  const beta = await scratchVitest()

  const KeySchema = S.Struct({
    envName: S.Literals(['STANDBY_ALPHA', 'STANDBY_BETA']),
    envValue: S.Literals(['one', 'two']),
    firstArg: S.Literals(['--enable-source-maps', '--no-warnings']),
    secondArg: S.Literals(['--title=stryker', '--title=vitest']),
  })

  type RequestKey = typeof KeySchema.Type

  const requestOf = (scratch: VitestScratch, key: RequestKey): PoolOptions => ({
    distPath: scratch.distPath,
    project: scratch.project,
    method: 'run',
    environment: { name: 'node', options: null },
    execArgv: [key.firstArg, key.secondArg],
    env: { [key.envName]: key.envValue },
  })

  const sameEnvKey = (left: RequestKey, right: RequestKey): boolean =>
    left.envName === right.envName && left.envValue === right.envValue

  const sameArgvKey = (left: RequestKey, right: RequestKey): boolean =>
    left.firstArg === right.firstArg && left.secondArg === right.secondArg

  const sameKey = (left: RequestKey, right: RequestKey): boolean => sameEnvKey(left, right) && sameArgvKey(left, right)

  interface ThreadHooks {
    readonly start: () => Promise<void>
    readonly stop: () => Promise<void>
  }

  interface ThreadDouble {
    readonly worker: PoolWorker
    readonly emit: (event: string) => void
    readonly listenerCount: (event: string) => number
    readonly stopCalls: () => number
    readonly stopSettled: () => boolean
  }

  const threadDoubleOf = (name: string, hooks: ThreadHooks): ThreadDouble => {
    const listeners = new Map<string, (() => void)[]>()
    let stopCalls = 0
    let stopSettlements = 0
    const worker: PoolWorker = {
      name,
      on: (event, callback) => {
        listeners.set(event, [...(listeners.get(event) ?? []), callback])
      },
      off: (event, callback) => {
        listeners.set(event, (listeners.get(event) ?? []).filter((listener) => listener !== callback))
      },
      send: () => undefined,
      deserialize: () => name,
      start: hooks.start,
      stop: () => {
        stopCalls = stopCalls + 1
        const stopping = hooks.stop()
        const counted = () => {
          stopSettlements = stopSettlements + 1
        }
        stopping.then(counted, counted)
        return stopping
      },
    }
    return {
      worker,
      emit: (event) => {
        const pending = listeners.get(event) ?? []
        pending.forEach((listener) => listener())
      },
      listenerCount: (event) => (listeners.get(event) ?? []).length,
      stopCalls: () => stopCalls,
      stopSettled: () => stopSettlements === stopCalls,
    }
  }

  interface SpawnSpy {
    readonly doubles: readonly ThreadDouble[]
    readonly spawn: SpawnWorker
  }

  const spawnSpyOf = (hooks: (ordinal: number) => ThreadHooks): SpawnSpy => {
    const doubles: ThreadDouble[] = []
    const spawn: SpawnWorker = () => {
      const double = threadDoubleOf('standby-double-' + String(doubles.length), hooks(doubles.length))
      doubles.push(double)
      return double.worker
    }
    return { doubles, spawn }
  }

  const doubleAt = (spy: SpawnSpy, index: number): ThreadDouble | undefined => spy.doubles.at(index)

  const probing = (worker: PoolWorker, marker: string): void => {
    worker.on(marker, () => undefined)
  }

  const probedBy = (spy: SpawnSpy, marker: string): readonly ThreadDouble[] =>
    spy.doubles.filter((double) => double.listenerCount(marker) > 0)

  const reusesSpare = (probed: readonly ThreadDouble[], target: ThreadDouble | undefined): boolean =>
    probed.length === 1 && probed[0] === target

  const resolving = (): Promise<void> => Promise.resolve()

  const rejectingWith = (refusal: Error): Promise<void> => Promise.resolve().then(() => Promise.reject(refusal))

  const rejectingLateWith = (refusal: Error): Promise<void> => Promise.resolve().then(() => rejectingWith(refusal))

  const outcomeOf = (settling: () => Promise<void>): Promise<Error | undefined> =>
    settling().then(
      () => undefined,
      (refusal) => (refusal instanceof Error ? refusal : new Error('the standby double refused its work')),
    )

  const emitsExit = (double: ThreadDouble | undefined): boolean =>
    Option.match(Option.fromNullishOr(double), {
      onNone: () => false,
      onSome: (present) => {
        present.emit('exit')
        return true
      },
    })

  const bootHooks = (refusal: Error): ThreadHooks => ({ start: () => rejectingWith(refusal), stop: resolving })

  const runningHooks: ThreadHooks = { start: resolving, stop: resolving }

  const hooksOf = (mode: 'boot' | 'exit', refusal: Error): ThreadHooks =>
    mode === 'boot' ? bootHooks(refusal) : runningHooks

  const expectedBootOf = (mode: 'boot' | 'exit', refusal: Error): Error | undefined =>
    mode === 'boot' ? refusal : undefined

  it.effect.prop(
    '∀k_SpareReuse_≡RequestKey',
    { of: { first: KeySchema, second: KeySchema }, subject: make },
    (makePool, { first, second }) =>
      Effect.gen(function*() {
        const home = spawnSpyOf(() => ({ start: resolving, stop: resolving }))
        const away = spawnSpyOf(() => ({ start: resolving, stop: resolving }))
        const homeRunner = initializer(makePool(home.spawn))
        const awayRunner = initializer(makePool(away.spawn))
        const booted = homeRunner.createPoolWorker(requestOf(alpha, first))
        const afterFirst = home.doubles.length
        const spare = doubleAt(home, afterFirst - 1)
        const claimed = homeRunner.createPoolWorker(requestOf(alpha, second))
        const afterSecond = home.doubles.length
        const standing = doubleAt(home, afterSecond - 1)
        const foreign = homeRunner.createPoolWorker(requestOf(beta, second))
        const awayClaim = awayRunner.createPoolWorker(requestOf(beta, first))
        probing(claimed, 'probe-second')
        probing(foreign, 'probe-foreign')
        probing(awayClaim, 'probe-away')
        const bootedStart = yield* Effect.promise(() => outcomeOf(() => booted.start()))
        const claimedStart = yield* Effect.promise(() => outcomeOf(() => claimed.start()))
        const awayStart = yield* Effect.promise(() => outcomeOf(() => awayClaim.start()))
        const expectedReuse = sameKey(first, second)
        return [
          reusesSpare(probedBy(home, 'probe-second'), spare) === expectedReuse,
          reusesSpare(probedBy(home, 'probe-foreign'), standing) === false,
          afterFirst === 2,
          afterSecond === (expectedReuse ? 3 : 4),
          home.doubles.length === afterSecond + 2,
          probedBy(away, 'probe-away')[0] === doubleAt(away, 0),
          away.doubles.length === 2,
          bootedStart === undefined,
          claimedStart === undefined,
          awayStart === undefined,
        ].every(Boolean)
      }).pipe(Effect.orDie),
  )

  it.effect.prop(
    '∀f_StandbyFailure_≡Cause',
    { of: { mode: S.Literals(['boot', 'exit']), key: KeySchema }, subject: initializer },
    (runnerOf, { mode, key }) =>
      Effect.gen(function*() {
        const homeRefusal = new Error('standby double: the home worker refused to start')
        const awayRefusal = new Error('standby double: the away worker refused to start')
        const home = spawnSpyOf(() => hooksOf(mode, homeRefusal))
        const away = spawnSpyOf(() => hooksOf(mode, awayRefusal))
        const homeClaim = runnerOf(make(home.spawn)).createPoolWorker(requestOf(alpha, key))
        const awayClaim = runnerOf(make(away.spawn)).createPoolWorker(requestOf(beta, key))
        const homeBoot = yield* Effect.promise(() => outcomeOf(() => homeClaim.start()))
        const awayBoot = yield* Effect.promise(() => outcomeOf(() => awayClaim.start()))
        const homeExit = emitsExit(doubleAt(home, 0))
        const awayExit = emitsExit(doubleAt(away, 0))
        const homeAfterExit = yield* Effect.promise(() => outcomeOf(() => homeClaim.start()))
        const awayAfterExit = yield* Effect.promise(() => outcomeOf(() => awayClaim.start()))
        return [
          home.doubles.length === 2,
          away.doubles.length === 2,
          homeBoot === expectedBootOf(mode, homeRefusal),
          awayBoot === expectedBootOf(mode, awayRefusal),
          homeExit,
          awayExit,
          homeAfterExit !== undefined,
          awayAfterExit !== undefined,
        ].every(Boolean)
      }).pipe(Effect.orDie),
  )

  it.effect.prop(
    '∀s_StandbyDispose_≡FirstFailure',
    { of: { first: KeySchema, second: KeySchema }, subject: dispose },
    (disposePool, { first, second }) =>
      Effect.gen(function*() {
        const homeLateFailure = new Error('standby double: the home claimed worker refused to stop')
        const homeEarlyFailure = new Error('standby double: the home spare refused to stop')
        const awayFailure = new Error('standby double: the away claimed worker refused to stop')
        const homeStops: readonly (() => Promise<void>)[] = [
          () => rejectingLateWith(homeLateFailure),
          () => rejectingWith(homeEarlyFailure),
          resolving,
          resolving,
          resolving,
          resolving,
        ]
        const awayStops: readonly (() => Promise<void>)[] = [() => rejectingWith(awayFailure), resolving]
        const home = spawnSpyOf((ordinal) => ({ start: resolving, stop: homeStops[ordinal] }))
        const away = spawnSpyOf((ordinal) => ({ start: resolving, stop: awayStops[ordinal] }))
        const homePool = make(home.spawn)
        const awayPool = make(away.spawn)
        const homeRunner = initializer(homePool)
        homeRunner.createPoolWorker(requestOf(alpha, first))
        homeRunner.createPoolWorker(requestOf(alpha, second))
        homeRunner.createPoolWorker(requestOf(beta, second))
        initializer(awayPool).createPoolWorker(requestOf(beta, first))
        const homeOutcome = yield* Effect.promise(() => outcomeOf(() => disposePool(homePool)))
        const awayOutcome = yield* Effect.promise(() => outcomeOf(() => disposePool(awayPool)))
        const disposed = [...home.doubles]
        const spared = [...away.doubles]
        const spawnedBefore = disposed.length
        const revived = homeRunner.createPoolWorker(requestOf(alpha, first))
        probing(revived, 'probe-revived')
        return [
          homeOutcome === homeLateFailure,
          awayOutcome === awayFailure,
          disposed.every((double) => double.stopCalls() === 1),
          disposed.every((double) => double.stopSettled()),
          spared.every((double) => double.stopCalls() === 1),
          spared.every((double) => double.stopSettled()),
          home.doubles.length === spawnedBefore + 2,
          probedBy(home, 'probe-revived')[0] === doubleAt(home, spawnedBefore),
        ].every(Boolean)
      }).pipe(Effect.orDie),
  )
}
