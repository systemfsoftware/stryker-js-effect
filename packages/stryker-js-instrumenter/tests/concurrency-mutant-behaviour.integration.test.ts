import { NodeFileSystem } from '@effect/platform-node'
import { Gherkin, Given, it, layer, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import type { InstrumentResult, Mutant } from '@systemfsoftware/stryker-js-instrumenter'
import { INSTRUMENTER_CONSTANTS } from '@systemfsoftware/stryker-js-instrumenter'
import {
  Cause,
  Deferred,
  Effect,
  Exit,
  Fiber,
  FileSystem,
  Layer,
  Option,
  PlatformError,
  Ref,
  Result,
  Semaphore,
  SynchronizedRef,
} from 'effect'
import { afterAll, beforeAll, expect } from 'vitest'

import { FixtureImportError } from './__fixtures__/concurrency-mutant-behaviour.schema.js'
import type { Form, Module, ScenarioKind, ShapeEntry } from './__fixtures__/effect-concurrency/shapes.js'
import { shapes } from './__fixtures__/effect-concurrency/shapes.js'
import { instrument } from './__fixtures__/instrument.js'

const FIXTURE_URL = new URL('./__fixtures__/effect-concurrency/', import.meta.url)
const SCRATCH_URL = new URL('../.scratch/concurrency-behaviour/', import.meta.url)
const FIXTURE_MODULES = [
  'atomic-update-split.ts',
  'synchronization-removal.ts',
  'finalizer-escape.ts',
  'refusals.ts',
] as const
const SUPPORT_MODULES = ['local-ref.ts'] as const

const LIVE = ['AtomicUpdateSplit', 'FinalizerEscape', 'SynchronizationRemoval'] as const
const FAILURE = 'boom'
const RESULT = 42
const ACQUIRED = 5

type Failure = typeof FAILURE

interface AcquiredState {
  readonly acquired: boolean
  readonly closed: boolean
}

interface AcquiredResult {
  readonly acquired: boolean
  readonly result: Outcome
}

type Outcome = void | undefined | number | string | boolean | AcquiredState | AcquiredResult

type AtomicModule = typeof import('./__fixtures__/effect-concurrency/atomic-update-split.js')
type SynchronizationRemovalModule = typeof import('./__fixtures__/effect-concurrency/synchronization-removal.js')
type FinalizerEscapeModule = typeof import('./__fixtures__/effect-concurrency/finalizer-escape.js')
type RefusalsModule = typeof import('./__fixtures__/effect-concurrency/refusals.js')

interface Instrumented {
  readonly atomic: Partial<AtomicModule>
  readonly synchronization: Partial<SynchronizationRemovalModule>
  readonly finalizer: Partial<FinalizerEscapeModule>
  readonly refusals: Partial<RefusalsModule>
}

interface Harness {
  readonly mutants: readonly Mutant[]
  readonly fixtureSources: Record<string, string>
  readonly modules: Instrumented
}

const isAtomicModule = (u: unknown): u is AtomicModule =>
  typeof u === 'object' && u !== null && 'refModifyDataFirst' in u

const isSynchronizationRemovalModule = (u: unknown): u is SynchronizationRemovalModule =>
  typeof u === 'object' && u !== null && 'withPermitsDataFirst' in u

const isFinalizerEscapeModule = (u: unknown): u is FinalizerEscapeModule =>
  typeof u === 'object' && u !== null && 'ensuringDataFirst' in u

const isRefusalsModule = (u: unknown): u is RefusalsModule =>
  typeof u === 'object' && u !== null && 'nestedCoveredCalls' in u

const filePathOf = (url: URL): string => url.pathname

let harness: Harness | undefined

const harnessOf = (): Harness => {
  if (harness === undefined) {
    throw new Error('the instrumented harness has not been built')
  }
  return harness
}

const isNamespaceRecord = (u: unknown): u is Record<string, string | undefined> => typeof u === 'object' && u !== null

const hostNamespace = (): object =>
  Option.getOrElse(
    Option.liftPredicate(isNamespaceRecord)(Reflect.get(globalThis, INSTRUMENTER_CONSTANTS.NAMESPACE)),
    () => {
      const created: Record<string, string | undefined> = {}
      Reflect.set(globalThis, INSTRUMENTER_CONSTANTS.NAMESPACE, created)
      return created
    },
  )

const setActiveMutant = (id: string | undefined): Effect.Effect<void> =>
  Effect.sync(() => Reflect.set(hostNamespace(), INSTRUMENTER_CONSTANTS.ACTIVE_MUTANT, id))

const withActiveMutant = <A, E>(id: string | undefined, effect: Effect.Effect<A, E>): Effect.Effect<A, E> =>
  Effect.flatMap(setActiveMutant(id), () => Effect.ensuring(effect, setActiveMutant(undefined)))

interface Observed {
  readonly succeeded: boolean
  readonly interrupted: boolean
  readonly result: Outcome
  readonly defect: Outcome
}

const succeeded = (result: Outcome): Observed => ({ succeeded: true, interrupted: false, result, defect: undefined })
const failedWith = (result: Outcome): Observed => ({ succeeded: false, interrupted: false, result, defect: undefined })
const diedWith = (defect: Outcome): Observed => ({ succeeded: false, interrupted: false, result: undefined, defect })
const interrupted: Observed = { succeeded: false, interrupted: true, result: undefined, defect: undefined }

const firstDefect = (exit: Exit.Exit<Outcome, Failure>): Outcome =>
  Option.match(Exit.getCause(exit), {
    onNone: () => undefined,
    onSome: (cause) => {
      const defect = Result.getOrUndefined(Cause.findDefect(cause))
      return typeof defect === 'string' ? defect : undefined
    },
  })

const observe = (exit: Exit.Exit<Outcome, Failure>): Observed => {
  if (Exit.isSuccess(exit)) {
    return succeeded(exit.value)
  }
  return {
    succeeded: false,
    interrupted: Exit.hasInterrupts(exit),
    result: Option.getOrUndefined(Exit.findErrorOption(exit)),
    defect: firstDefect(exit),
  }
}
const failingWith = <A>(effect: Effect.Effect<A, Failure>): Effect.Effect<A, Failure> =>
  Effect.andThen(effect, Effect.fail<Failure>(FAILURE))

interface Prepared {
  readonly effect: Effect.Effect<Outcome, Failure>
  readonly readState: () => Effect.Effect<Outcome>
  readonly settle?: Effect.Effect<void>
}

interface InterruptPrepared {
  readonly region: Effect.Effect<Outcome, Failure>
  readonly startSignal: Effect.Effect<void>
  readonly resume: Effect.Effect<void>
  readonly readState: () => Effect.Effect<Outcome>
}

interface TwiceReport {
  readonly first: Observed
  readonly afterFirst: Outcome
  readonly second: Observed
  readonly afterSecond: Outcome
}

interface TwiceObserved {
  readonly first: Observed
  readonly second: Observed
}

interface InterruptReport {
  readonly exit: Observed
  readonly state: Outcome
}

const twiceReport = (prepare: Effect.Effect<Prepared>): Effect.Effect<TwiceReport> =>
  Effect.gen(function*() {
    const prepared = yield* prepare
    const first = observe(yield* Effect.exit(prepared.effect))
    const afterFirst = yield* prepared.readState()
    const second = observe(yield* Effect.exit(prepared.effect))
    return { first, afterFirst, second, afterSecond: yield* prepared.readState() }
  })

const twiceObserved = (prepare: Effect.Effect<Pick<Prepared, 'effect'>>): Effect.Effect<TwiceObserved> =>
  Effect.gen(function*() {
    const prepared = yield* prepare
    const first = observe(yield* Effect.exit(prepared.effect))
    const second = observe(yield* Effect.exit(prepared.effect))
    return { first, second }
  })

const raceReport = (prepare: Effect.Effect<Prepared>): Effect.Effect<Outcome, Failure> =>
  Effect.gen(function*() {
    const prepared = yield* prepare
    const fibers = yield* Effect.all([Effect.forkChild(prepared.effect), Effect.forkChild(prepared.effect)])
    if (prepared.settle !== undefined) {
      yield* prepared.settle
    }
    yield* Fiber.join(fibers[0])
    yield* Fiber.join(fibers[1])
    return yield* prepared.readState()
  })

const settleArrivals = (arrivals: Ref.Ref<number>, gate: Deferred.Deferred<void>): Effect.Effect<void> => {
  const settle = (remaining: number): Effect.Effect<void> =>
    Effect.flatMap(Ref.get(arrivals), (arrived) =>
      arrived >= 2 || remaining <= 0
        ? Deferred.succeed(gate, undefined)
        : Effect.flatMap(Effect.yieldNow, () => settle(remaining - 1)))
  return settle(64)
}

const awaitFlag = (flag: Ref.Ref<boolean>): Effect.Effect<void> => {
  const awaitIt = (remaining: number): Effect.Effect<void> =>
    Effect.flatMap(Ref.get(flag), (marked) =>
      marked
        ? Effect.void
        : remaining <= 0
        ? Effect.die('the acquire never marked the resource as acquired')
        : Effect.flatMap(Effect.yieldNow, () => awaitIt(remaining - 1)))
  return awaitIt(1000)
}

const interruptedRun = (
  prepare: Effect.Effect<InterruptPrepared>,
): Effect.Effect<InterruptReport> =>
  Effect.gen(function*() {
    const prepared = yield* prepare
    const fiber = yield* Effect.forkChild(prepared.region)
    yield* prepared.startSignal
    const stopper = yield* Effect.forkChild(Fiber.interrupt(fiber))
    yield* Effect.yieldNow
    yield* Effect.yieldNow
    yield* prepared.resume
    yield* Fiber.join(stopper)
    const exit = yield* Fiber.await(fiber)
    return { exit: observe(exit), state: yield* prepared.readState() }
  })

const freePermits = (sem: Semaphore.Semaphore): Effect.Effect<number> => {
  const drain = (taken: number): Effect.Effect<number> =>
    Effect.flatMap(
      Semaphore.takeIfAvailable(sem, 1),
      (tookOne) => (tookOne ? drain(taken + 1) : Effect.succeed(taken)),
    )
  return Effect.flatMap(drain(0), (free) => Effect.as(Semaphore.release(sem, free), free))
}

const suspendingInner = (started: Deferred.Deferred<void>, gate: Deferred.Deferred<void>): Effect.Effect<number> =>
  Effect.flatMap(
    Deferred.succeed(started, undefined),
    () => Effect.map(Deferred.await(gate), () => RESULT),
  )

interface RefCase {
  readonly start: number
  readonly equivalenceSuccess: TwiceReport
  readonly equivalenceFailure: TwiceReport
  readonly race: { readonly original: number; readonly mutant: number }
}

interface PartialCase {
  readonly start: number
  readonly matched: TwiceReport
  readonly unmatched: TwiceReport
  readonly race: { readonly original: number; readonly mutant: number }
}

const MODIFY_CASE: RefCase = {
  start: 0,
  equivalenceSuccess: { first: succeeded(0), second: succeeded(1), afterFirst: 1, afterSecond: 2 },
  equivalenceFailure: { first: failedWith(FAILURE), second: failedWith(FAILURE), afterFirst: 1, afterSecond: 2 },
  race: { original: 2, mutant: 1 },
}

const UPDATE_CASE: RefCase = {
  start: 0,
  equivalenceSuccess: { first: succeeded(undefined), second: succeeded(undefined), afterFirst: 1, afterSecond: 2 },
  equivalenceFailure: { first: failedWith(FAILURE), second: failedWith(FAILURE), afterFirst: 1, afterSecond: 2 },
  race: { original: 2, mutant: 1 },
}

const UPDATE_AND_GET_CASE: RefCase = {
  start: 3,
  equivalenceSuccess: { first: succeeded(6), second: succeeded(12), afterFirst: 6, afterSecond: 12 },
  equivalenceFailure: { first: failedWith(FAILURE), second: failedWith(FAILURE), afterFirst: 6, afterSecond: 12 },
  race: { original: 12, mutant: 6 },
}

const GET_AND_UPDATE_CASE: RefCase = {
  start: 0,
  equivalenceSuccess: { first: succeeded(0), second: succeeded(10), afterFirst: 10, afterSecond: 20 },
  equivalenceFailure: { first: failedWith(FAILURE), second: failedWith(FAILURE), afterFirst: 10, afterSecond: 20 },
  race: { original: 20, mutant: 10 },
}

const MODIFY_SOME_CASE: PartialCase = {
  start: 0,
  matched: { first: succeeded('bumped'), second: succeeded('bumped'), afterFirst: 5, afterSecond: 10 },
  unmatched: { first: succeeded('skipped'), second: succeeded('skipped'), afterFirst: 0, afterSecond: 0 },
  race: { original: 10, mutant: 5 },
}

const UPDATE_SOME_CASE: PartialCase = {
  start: 0,
  matched: { first: succeeded(undefined), second: succeeded(undefined), afterFirst: 5, afterSecond: 10 },
  unmatched: { first: succeeded(undefined), second: succeeded(undefined), afterFirst: 0, afterSecond: 0 },
  race: { original: 10, mutant: 5 },
}

const matchedModify = (n: number): readonly [string, Option.Option<number>] => ['bumped', Option.some(n + 5)]
const unmatchedModify = (_n: number): readonly [string, Option.Option<number>] => ['skipped', Option.none()]
const matchedUpdate = (n: number): Option.Option<number> => Option.some(n + 5)
const unmatchedUpdate = (_n: number): Option.Option<number> => Option.none()

interface PlainDriver<State> {
  readonly case: RefCase
  readonly build: (modules: Instrumented, state: State) => Effect.Effect<Outcome, Failure>
}

interface PartialDriver<State, PartialFunction> {
  readonly case: PartialCase
  readonly build: (modules: Instrumented, state: State, pf: PartialFunction) => Effect.Effect<Outcome, Failure>
}

const REF_PLAIN_DRIVERS: Readonly<Record<string, PlainDriver<Ref.Ref<number>>>> = {
  refModifyDataFirst: {
    case: MODIFY_CASE,
    build: (m, ref) => requireExport(m.atomic.refModifyDataFirst, 'refModifyDataFirst')(ref),
  },
  refModifyPipeArg: {
    case: MODIFY_CASE,
    build: (m, ref) => requireExport(m.atomic.refModifyPipeArg, 'refModifyPipeArg')(ref),
  },
  refModifyPipeMethod: {
    case: MODIFY_CASE,
    build: (m, ref) => requireExport(m.atomic.refModifyPipeMethod, 'refModifyPipeMethod')(ref),
  },
  refUpdateDataFirst: {
    case: UPDATE_CASE,
    build: (m, ref) => requireExport(m.atomic.refUpdateDataFirst, 'refUpdateDataFirst')(ref),
  },
  refUpdatePipeArg: {
    case: UPDATE_CASE,
    build: (m, ref) => requireExport(m.atomic.refUpdatePipeArg, 'refUpdatePipeArg')(ref),
  },
  refUpdatePipeMethod: {
    case: UPDATE_CASE,
    build: (m, ref) => requireExport(m.atomic.refUpdatePipeMethod, 'refUpdatePipeMethod')(ref),
  },
  refUpdateImmediate: {
    case: UPDATE_CASE,
    build: (m, ref) => requireExport(m.atomic.refUpdateImmediate, 'refUpdateImmediate')(ref),
  },
  refUpdateAndGetDataFirst: {
    case: UPDATE_AND_GET_CASE,
    build: (m, ref) => requireExport(m.atomic.refUpdateAndGetDataFirst, 'refUpdateAndGetDataFirst')(ref),
  },
  refUpdateAndGetPipeArg: {
    case: UPDATE_AND_GET_CASE,
    build: (m, ref) => requireExport(m.atomic.refUpdateAndGetPipeArg, 'refUpdateAndGetPipeArg')(ref),
  },
  refUpdateAndGetPipeMethod: {
    case: UPDATE_AND_GET_CASE,
    build: (m, ref) => requireExport(m.atomic.refUpdateAndGetPipeMethod, 'refUpdateAndGetPipeMethod')(ref),
  },
  refGetAndUpdateDataFirst: {
    case: GET_AND_UPDATE_CASE,
    build: (m, ref) => requireExport(m.atomic.refGetAndUpdateDataFirst, 'refGetAndUpdateDataFirst')(ref),
  },
  refGetAndUpdatePipeArg: {
    case: GET_AND_UPDATE_CASE,
    build: (m, ref) => requireExport(m.atomic.refGetAndUpdatePipeArg, 'refGetAndUpdatePipeArg')(ref),
  },
  refGetAndUpdatePipeMethod: {
    case: GET_AND_UPDATE_CASE,
    build: (m, ref) => requireExport(m.atomic.refGetAndUpdatePipeMethod, 'refGetAndUpdatePipeMethod')(ref),
  },
}

const SYNC_PLAIN_DRIVERS: Readonly<Record<string, PlainDriver<SynchronizedRef.SynchronizedRef<number>>>> = {
  syncModifyDataFirst: {
    case: MODIFY_CASE,
    build: (m, ref) => requireExport(m.atomic.syncModifyDataFirst, 'syncModifyDataFirst')(ref),
  },
  syncModifyPipeArg: {
    case: MODIFY_CASE,
    build: (m, ref) => requireExport(m.atomic.syncModifyPipeArg, 'syncModifyPipeArg')(ref),
  },
  syncModifyPipeMethod: {
    case: MODIFY_CASE,
    build: (m, ref) => requireExport(m.atomic.syncModifyPipeMethod, 'syncModifyPipeMethod')(ref),
  },
  syncUpdateDataFirst: {
    case: UPDATE_CASE,
    build: (m, ref) => requireExport(m.atomic.syncUpdateDataFirst, 'syncUpdateDataFirst')(ref),
  },
  syncUpdatePipeArg: {
    case: UPDATE_CASE,
    build: (m, ref) => requireExport(m.atomic.syncUpdatePipeArg, 'syncUpdatePipeArg')(ref),
  },
  syncUpdatePipeMethod: {
    case: UPDATE_CASE,
    build: (m, ref) => requireExport(m.atomic.syncUpdatePipeMethod, 'syncUpdatePipeMethod')(ref),
  },
  syncUpdateAndGetDataFirst: {
    case: UPDATE_AND_GET_CASE,
    build: (m, ref) => requireExport(m.atomic.syncUpdateAndGetDataFirst, 'syncUpdateAndGetDataFirst')(ref),
  },
  syncUpdateAndGetPipeArg: {
    case: UPDATE_AND_GET_CASE,
    build: (m, ref) => requireExport(m.atomic.syncUpdateAndGetPipeArg, 'syncUpdateAndGetPipeArg')(ref),
  },
  syncUpdateAndGetPipeMethod: {
    case: UPDATE_AND_GET_CASE,
    build: (m, ref) => requireExport(m.atomic.syncUpdateAndGetPipeMethod, 'syncUpdateAndGetPipeMethod')(ref),
  },
  syncGetAndUpdateDataFirst: {
    case: GET_AND_UPDATE_CASE,
    build: (m, ref) => requireExport(m.atomic.syncGetAndUpdateDataFirst, 'syncGetAndUpdateDataFirst')(ref),
  },
  syncGetAndUpdatePipeArg: {
    case: GET_AND_UPDATE_CASE,
    build: (m, ref) => requireExport(m.atomic.syncGetAndUpdatePipeArg, 'syncGetAndUpdatePipeArg')(ref),
  },
  syncGetAndUpdatePipeMethod: {
    case: GET_AND_UPDATE_CASE,
    build: (m, ref) => requireExport(m.atomic.syncGetAndUpdatePipeMethod, 'syncGetAndUpdatePipeMethod')(ref),
  },
}

const REF_MODIFY_SOME_DRIVERS: Readonly<
  Record<string, PartialDriver<Ref.Ref<number>, (n: number) => readonly [string, Option.Option<number>]>>
> = {
  refModifySomeDataFirst: {
    case: MODIFY_SOME_CASE,
    build: (m, ref, pf) => requireExport(m.atomic.refModifySomeDataFirst, 'refModifySomeDataFirst')(ref, pf),
  },
  refModifySomePipeArg: {
    case: MODIFY_SOME_CASE,
    build: (m, ref, pf) => requireExport(m.atomic.refModifySomePipeArg, 'refModifySomePipeArg')(ref, pf),
  },
  refModifySomePipeMethod: {
    case: MODIFY_SOME_CASE,
    build: (m, ref, pf) => requireExport(m.atomic.refModifySomePipeMethod, 'refModifySomePipeMethod')(ref, pf),
  },
}

const REF_UPDATE_SOME_DRIVERS: Readonly<
  Record<string, PartialDriver<Ref.Ref<number>, (n: number) => Option.Option<number>>>
> = {
  refUpdateSomeDataFirst: {
    case: UPDATE_SOME_CASE,
    build: (m, ref, pf) => requireExport(m.atomic.refUpdateSomeDataFirst, 'refUpdateSomeDataFirst')(ref, pf),
  },
  refUpdateSomePipeArg: {
    case: UPDATE_SOME_CASE,
    build: (m, ref, pf) => requireExport(m.atomic.refUpdateSomePipeArg, 'refUpdateSomePipeArg')(ref, pf),
  },
  refUpdateSomePipeMethod: {
    case: UPDATE_SOME_CASE,
    build: (m, ref, pf) => requireExport(m.atomic.refUpdateSomePipeMethod, 'refUpdateSomePipeMethod')(ref, pf),
  },
}

const SYNC_MODIFY_SOME_DRIVERS: Readonly<
  Record<
    string,
    PartialDriver<SynchronizedRef.SynchronizedRef<number>, (n: number) => readonly [string, Option.Option<number>]>
  >
> = {
  syncModifySomeDataFirst: {
    case: MODIFY_SOME_CASE,
    build: (m, ref, pf) => requireExport(m.atomic.syncModifySomeDataFirst, 'syncModifySomeDataFirst')(ref, pf),
  },
  syncModifySomePipeArg: {
    case: MODIFY_SOME_CASE,
    build: (m, ref, pf) => requireExport(m.atomic.syncModifySomePipeArg, 'syncModifySomePipeArg')(ref, pf),
  },
  syncModifySomePipeMethod: {
    case: MODIFY_SOME_CASE,
    build: (m, ref, pf) => requireExport(m.atomic.syncModifySomePipeMethod, 'syncModifySomePipeMethod')(ref, pf),
  },
}

const SYNC_UPDATE_SOME_DRIVERS: Readonly<
  Record<string, PartialDriver<SynchronizedRef.SynchronizedRef<number>, (n: number) => Option.Option<number>>>
> = {
  syncUpdateSomeDataFirst: {
    case: UPDATE_SOME_CASE,
    build: (m, ref, pf) => requireExport(m.atomic.syncUpdateSomeDataFirst, 'syncUpdateSomeDataFirst')(ref, pf),
  },
  syncUpdateSomePipeArg: {
    case: UPDATE_SOME_CASE,
    build: (m, ref, pf) => requireExport(m.atomic.syncUpdateSomePipeArg, 'syncUpdateSomePipeArg')(ref, pf),
  },
  syncUpdateSomePipeMethod: {
    case: UPDATE_SOME_CASE,
    build: (m, ref, pf) => requireExport(m.atomic.syncUpdateSomePipeMethod, 'syncUpdateSomePipeMethod')(ref, pf),
  },
}

interface SemaphoreCase {
  readonly equivalenceSuccess: TwiceReport
  readonly equivalenceFailure: TwiceReport
  readonly peak: { readonly original: number; readonly mutant: number }
}

const SEMAPHORE_CASE: SemaphoreCase = {
  equivalenceSuccess: { first: succeeded(RESULT), second: succeeded(RESULT), afterFirst: 1, afterSecond: 1 },
  equivalenceFailure: { first: diedWith(FAILURE), second: diedWith(FAILURE), afterFirst: 1, afterSecond: 1 },
  peak: { original: 1, mutant: 2 },
}

interface SemaphoreDriver {
  readonly build: (
    modules: Instrumented,
    sem: Semaphore.Semaphore,
    effect: Effect.Effect<number>,
  ) => Effect.Effect<Outcome, Failure>
}

const SEMAPHORE_DRIVERS: Readonly<Record<string, SemaphoreDriver>> = {
  withPermitsDataFirst: {
    build: (m, sem, effect) =>
      requireExport(m.synchronization.withPermitsDataFirst, 'withPermitsDataFirst')(sem, effect),
  },
  withPermitsPipeArg: {
    build: (m, sem, effect) => requireExport(m.synchronization.withPermitsPipeArg, 'withPermitsPipeArg')(sem, effect),
  },
  withPermitsPipeMethod: {
    build: (m, sem, effect) =>
      requireExport(m.synchronization.withPermitsPipeMethod, 'withPermitsPipeMethod')(sem, effect),
  },
  withPermitsImmediate: {
    build: (m, sem, effect) =>
      requireExport(m.synchronization.withPermitsImmediate, 'withPermitsImmediate')(sem, effect),
  },
  withPermitDataFirst: {
    build: (m, sem, effect) => requireExport(m.synchronization.withPermitDataFirst, 'withPermitDataFirst')(sem, effect),
  },
  withPermitPipeArg: {
    build: (m, sem, effect) => requireExport(m.synchronization.withPermitPipeArg, 'withPermitPipeArg')(sem, effect),
  },
  withPermitPipeMethod: {
    build: (m, sem, effect) =>
      requireExport(m.synchronization.withPermitPipeMethod, 'withPermitPipeMethod')(sem, effect),
  },
}

interface InterruptExpectations {
  readonly original: InterruptReport
  readonly mutant: InterruptReport
}

interface RegionCase {
  readonly equivalenceSuccess: TwiceObserved
  readonly equivalenceFailure: TwiceObserved
  readonly interrupt: InterruptExpectations
}

const REGION_CASE: RegionCase = {
  equivalenceSuccess: { first: succeeded(RESULT), second: succeeded(RESULT) },
  equivalenceFailure: { first: diedWith(FAILURE), second: diedWith(FAILURE) },
  interrupt: {
    original: { exit: interrupted, state: true },
    mutant: { exit: interrupted, state: false },
  },
}

interface RegionDriver {
  readonly case: RegionCase
  readonly build: (modules: Instrumented, inner: Effect.Effect<number>) => Effect.Effect<Outcome, Failure>
  readonly interruptedBuild: (modules: Instrumented, inner: Effect.Effect<number>) => Effect.Effect<Outcome, Failure>
}

const REGION_DRIVERS: Readonly<Record<string, RegionDriver>> = {
  uninterruptibleCall: {
    case: REGION_CASE,
    build: (m, inner) => requireExport(m.synchronization.uninterruptibleCall, 'uninterruptibleCall')(inner),
    interruptedBuild: (m, inner) => requireExport(m.synchronization.uninterruptibleCall, 'uninterruptibleCall')(inner),
  },
  uninterruptiblePipedReference: {
    case: REGION_CASE,
    build: (m, inner) =>
      requireExport(m.synchronization.uninterruptiblePipedReference, 'uninterruptiblePipedReference')(inner),
    interruptedBuild: (m, inner) =>
      requireExport(m.synchronization.uninterruptiblePipedReference, 'uninterruptiblePipedReference')(inner),
  },
  uninterruptibleMaskRegion: {
    case: REGION_CASE,
    build: (m, inner) => requireExport(m.synchronization.uninterruptibleMaskRegion, 'uninterruptibleMaskRegion')(inner),
    interruptedBuild: (m, inner) =>
      Effect.uninterruptible(
        requireExport(m.synchronization.uninterruptibleMaskRegion, 'uninterruptibleMaskRegion')(inner),
      ),
  },
}

interface FinalizerCase {
  readonly equivalenceSuccess: TwiceReport
  readonly equivalenceFailure: TwiceReport
  readonly interrupt: InterruptExpectations
}

const ENSURING_CASE: FinalizerCase = {
  equivalenceSuccess: { first: succeeded(RESULT), second: succeeded(RESULT), afterFirst: true, afterSecond: true },
  equivalenceFailure: { first: diedWith(FAILURE), second: diedWith(FAILURE), afterFirst: true, afterSecond: true },
  interrupt: {
    original: { exit: interrupted, state: true },
    mutant: { exit: interrupted, state: false },
  },
}

const ON_ERROR_CASE: FinalizerCase = {
  equivalenceSuccess: { first: succeeded(RESULT), second: succeeded(RESULT), afterFirst: false, afterSecond: false },
  equivalenceFailure: { first: diedWith(FAILURE), second: diedWith(FAILURE), afterFirst: true, afterSecond: true },
  interrupt: {
    original: { exit: interrupted, state: true },
    mutant: { exit: interrupted, state: false },
  },
}

const ON_INTERRUPT_CASE: FinalizerCase = {
  equivalenceSuccess: { first: succeeded(RESULT), second: succeeded(RESULT), afterFirst: false, afterSecond: false },
  equivalenceFailure: { first: diedWith(FAILURE), second: diedWith(FAILURE), afterFirst: false, afterSecond: false },
  interrupt: {
    original: { exit: interrupted, state: true },
    mutant: { exit: interrupted, state: false },
  },
}

interface ClosedFinalizerDriver {
  readonly case: FinalizerCase
  readonly build: (
    modules: Instrumented,
    inner: Effect.Effect<number>,
    closed: Ref.Ref<boolean>,
  ) => Effect.Effect<Outcome, Failure>
}

const ENSURING_DRIVERS: Readonly<Record<string, ClosedFinalizerDriver>> = {
  ensuringDataFirst: {
    case: ENSURING_CASE,
    build: (m, inner, closed) => requireExport(m.finalizer.ensuringDataFirst, 'ensuringDataFirst')(inner, closed),
  },
  ensuringPipeArg: {
    case: ENSURING_CASE,
    build: (m, inner, closed) => requireExport(m.finalizer.ensuringPipeArg, 'ensuringPipeArg')(inner, closed),
  },
  ensuringPipeMethod: {
    case: ENSURING_CASE,
    build: (m, inner, closed) => requireExport(m.finalizer.ensuringPipeMethod, 'ensuringPipeMethod')(inner, closed),
  },
}

const ON_EXIT_DRIVERS: Readonly<Record<string, ClosedFinalizerDriver>> = {
  onExitDataFirst: {
    case: ENSURING_CASE,
    build: (m, inner, closed) => requireExport(m.finalizer.onExitDataFirst, 'onExitDataFirst')(inner, closed),
  },
  onExitPipeArg: {
    case: ENSURING_CASE,
    build: (m, inner, closed) => requireExport(m.finalizer.onExitPipeArg, 'onExitPipeArg')(inner, closed),
  },
  onExitPipeMethod: {
    case: ENSURING_CASE,
    build: (m, inner, closed) => requireExport(m.finalizer.onExitPipeMethod, 'onExitPipeMethod')(inner, closed),
  },
}

const ON_ERROR_DRIVERS: Readonly<Record<string, ClosedFinalizerDriver>> = {
  onErrorDataFirst: {
    case: ON_ERROR_CASE,
    build: (m, inner, closed) => requireExport(m.finalizer.onErrorDataFirst, 'onErrorDataFirst')(inner, closed),
  },
  onErrorPipeArg: {
    case: ON_ERROR_CASE,
    build: (m, inner, closed) => requireExport(m.finalizer.onErrorPipeArg, 'onErrorPipeArg')(inner, closed),
  },
  onErrorPipeMethod: {
    case: ON_ERROR_CASE,
    build: (m, inner, closed) => requireExport(m.finalizer.onErrorPipeMethod, 'onErrorPipeMethod')(inner, closed),
  },
}

const ON_INTERRUPT_DRIVERS: Readonly<Record<string, ClosedFinalizerDriver>> = {
  onInterruptDataFirst: {
    case: ON_INTERRUPT_CASE,
    build: (m, inner, closed) => requireExport(m.finalizer.onInterruptDataFirst, 'onInterruptDataFirst')(inner, closed),
  },
  onInterruptPipeArg: {
    case: ON_INTERRUPT_CASE,
    build: (m, inner, closed) => requireExport(m.finalizer.onInterruptPipeArg, 'onInterruptPipeArg')(inner, closed),
  },
  onInterruptPipeMethod: {
    case: ON_INTERRUPT_CASE,
    build: (m, inner, closed) =>
      requireExport(m.finalizer.onInterruptPipeMethod, 'onInterruptPipeMethod')(inner, closed),
  },
}

interface BracketCase {
  readonly equivalenceSuccess: TwiceReport
  readonly equivalenceFailure: TwiceReport
}

const BRACKET_CASE: BracketCase = {
  equivalenceSuccess: { first: succeeded(ACQUIRED), second: succeeded(ACQUIRED), afterFirst: true, afterSecond: true },
  equivalenceFailure: { first: failedWith(FAILURE), second: failedWith(FAILURE), afterFirst: true, afterSecond: true },
}

interface AcquireReleaseDriver {
  readonly case: BracketCase
  readonly build: (modules: Instrumented, closed: Ref.Ref<boolean>) => Effect.Effect<Outcome, Failure>
}

const ACQUIRE_RELEASE_DRIVERS: Readonly<Record<string, AcquireReleaseDriver>> = {
  acquireReleaseTwoArg: {
    case: BRACKET_CASE,
    build: (m, closed) =>
      Effect.scoped(
        requireExport(m.finalizer.acquireReleaseTwoArg, 'acquireReleaseTwoArg')(Effect.succeed(ACQUIRED), closed),
      ),
  },
  acquireReleaseThreeArg: {
    case: BRACKET_CASE,
    build: (m, closed) =>
      Effect.scoped(
        requireExport(m.finalizer.acquireReleaseThreeArg, 'acquireReleaseThreeArg')(
          Effect.succeed(ACQUIRED),
          closed,
          {},
        ),
      ),
  },
}

interface AcquireUseReleaseCase extends BracketCase {
  readonly interrupt: InterruptExpectations
}

const ACQUIRE_USE_RELEASE_CASE: AcquireUseReleaseCase = {
  equivalenceSuccess: {
    first: succeeded(ACQUIRED + 1),
    second: succeeded(ACQUIRED + 1),
    afterFirst: true,
    afterSecond: true,
  },
  equivalenceFailure: { first: diedWith(FAILURE), second: diedWith(FAILURE), afterFirst: true, afterSecond: true },
  interrupt: {
    original: { exit: interrupted, state: true },
    mutant: { exit: interrupted, state: false },
  },
}

interface AcquireUseReleaseDriver {
  readonly build: (
    modules: Instrumented,
    use: (acquired: number) => Effect.Effect<number>,
    closed: Ref.Ref<boolean>,
  ) => Effect.Effect<Outcome, Failure>
}

const ACQUIRE_USE_RELEASE_DRIVERS: Readonly<Record<string, AcquireUseReleaseDriver>> = {
  acquireUseReleaseBrackets: {
    build: (m, use, closed) =>
      Effect.scoped(
        requireExport(m.finalizer.acquireUseReleaseBrackets, 'acquireUseReleaseBrackets')(
          Effect.succeed(ACQUIRED),
          use,
          closed,
        ),
      ),
  },
}

const ACQUIRE_DIVERGENCE_CASE: InterruptExpectations = {
  original: { exit: interrupted, state: { acquired: true, closed: true } },
  mutant: { exit: interrupted, state: { acquired: true, closed: false } },
}

const LEADER_LOCK_CASE: FinalizerCase = {
  equivalenceSuccess: {
    first: succeeded({ acquired: true, result: RESULT }),
    second: succeeded({ acquired: true, result: RESULT }),
    afterFirst: true,
    afterSecond: true,
  },
  equivalenceFailure: { first: diedWith(FAILURE), second: diedWith(FAILURE), afterFirst: true, afterSecond: true },
  interrupt: {
    original: { exit: interrupted, state: true },
    mutant: { exit: interrupted, state: false },
  },
}

const LEADER_LOCK_DRIVER: ClosedFinalizerDriver = {
  case: LEADER_LOCK_CASE,
  build: (m, guarded, closed) =>
    requireExport(m.finalizer.leaderLockScopeClose, 'leaderLockScopeClose')(Effect.succeed(true), guarded, closed),
}

interface NestedCoveredCase {
  readonly equivalenceSuccess: TwiceReport
  readonly equivalenceFailure: TwiceReport
}

const NESTED_COVERED_CASE: NestedCoveredCase = {
  equivalenceSuccess: { first: succeeded(RESULT), second: succeeded(RESULT), afterFirst: true, afterSecond: true },
  equivalenceFailure: { first: diedWith(FAILURE), second: diedWith(FAILURE), afterFirst: true, afterSecond: true },
}

interface NestedCoveredDriver {
  readonly case: NestedCoveredCase
  readonly build: (
    modules: Instrumented,
    inner: Effect.Effect<number>,
    flag: Ref.Ref<boolean>,
  ) => Effect.Effect<Outcome, Failure>
}

const NESTED_COVERED_DRIVERS: Readonly<Record<string, NestedCoveredDriver>> = {
  nestedCoveredCalls: {
    case: NESTED_COVERED_CASE,
    build: (m, inner, flag) => requireExport(m.refusals.nestedCoveredCalls, 'nestedCoveredCalls')(inner, flag),
  },
}

const requireExport = <A>(value: A | undefined, label: string): A => {
  if (value === undefined) {
    throw new Error(`the instrumented fixture lost its export ${label}`)
  }
  return value
}

const lookupOrThrow = <V>(table: Readonly<Record<string, V>>, key: string, label: string): V => {
  const value = table[key]
  if (value === undefined) {
    throw new Error(`no ${label} for ${key}`)
  }
  return value
}

type ScenarioResult = Outcome | TwiceReport | TwiceObserved | InterruptReport

interface ScenarioSide {
  readonly run: Effect.Effect<ScenarioResult, Failure>
  readonly expected: ScenarioResult
}

type SideRunner = (
  entry: ShapeEntry,
  kind: ScenarioKind,
  modules: Instrumented,
  mutantId: string,
  withFault: boolean,
) => ScenarioSide

interface ScenarioSides {
  readonly withoutFault: ScenarioSide
  readonly withFault: readonly ScenarioSide[]
}

const equivalenceSide = (
  prepare: Effect.Effect<Prepared>,
  expected: ScenarioResult,
  mutantId: string,
  withFault: boolean,
): ScenarioSide => ({
  run: withActiveMutant(withFault ? mutantId : undefined, twiceReport(prepare)),
  expected,
})

const observedSide = (
  run: Effect.Effect<TwiceObserved, Failure>,
  expected: ScenarioResult,
  mutantId: string,
  withFault: boolean,
): ScenarioSide => ({
  run: withActiveMutant(withFault ? mutantId : undefined, run),
  expected,
})

const raceSide = (
  prepare: Effect.Effect<Prepared>,
  expected: number,
  mutantId: string,
  withFault: boolean,
): ScenarioSide => ({
  run: withActiveMutant(withFault ? mutantId : undefined, raceReport(prepare)),
  expected,
})

const interruptSide = (
  prepare: Effect.Effect<InterruptPrepared>,
  expected: InterruptReport,
  mutantId: string,
  withFault: boolean,
): ScenarioSide => ({
  run: withActiveMutant(withFault ? mutantId : undefined, interruptedRun(prepare)),
  expected,
})

const refPrepare = (
  modules: Instrumented,
  build: (modules: Instrumented, state: Ref.Ref<number>) => Effect.Effect<Outcome, Failure>,
  composeFailure: boolean,
  start: number,
): Effect.Effect<Prepared> =>
  Effect.map(Ref.make(start), (ref): Prepared => ({
    effect: composeFailure ? failingWith(build(modules, ref)) : build(modules, ref),
    readState: () => Ref.get(ref),
  }))

const syncPrepare = (
  modules: Instrumented,
  build: (modules: Instrumented, state: SynchronizedRef.SynchronizedRef<number>) => Effect.Effect<Outcome, Failure>,
  composeFailure: boolean,
  start: number,
): Effect.Effect<Prepared> =>
  Effect.map(SynchronizedRef.make(start), (ref): Prepared => ({
    effect: composeFailure ? failingWith(build(modules, ref)) : build(modules, ref),
    readState: () => SynchronizedRef.get(ref),
  }))

const plainSideFor = <State>(
  table: Readonly<Record<string, PlainDriver<State>>>,
  prepare: (
    modules: Instrumented,
    build: (modules: Instrumented, state: State) => Effect.Effect<Outcome, Failure>,
    composeFailure: boolean,
    start: number,
  ) => Effect.Effect<Prepared>,
): SideRunner =>
(entry, kind, modules, mutantId, withFault) => {
  const driver = lookupOrThrow(table, entry.exportName, 'behaviour driver')
  if (kind === 'divergence-two-fibers') {
    return raceSide(
      prepare(modules, driver.build, false, driver.case.start),
      driver.case.race[withFault ? 'mutant' : 'original'],
      mutantId,
      withFault,
    )
  }
  const composeFailure = kind === 'equivalence-failure'
  return equivalenceSide(
    prepare(modules, driver.build, composeFailure, driver.case.start),
    composeFailure ? driver.case.equivalenceFailure : driver.case.equivalenceSuccess,
    mutantId,
    withFault,
  )
}

const refPlainSide = plainSideFor(REF_PLAIN_DRIVERS, refPrepare)
const syncPlainSide = plainSideFor(SYNC_PLAIN_DRIVERS, syncPrepare)

const partialSideFor = <State, PartialFunction>(
  table: Readonly<Record<string, PartialDriver<State, PartialFunction>>>,
  prepare: (
    modules: Instrumented,
    build: (modules: Instrumented, state: State, pf: PartialFunction) => Effect.Effect<Outcome, Failure>,
    pf: PartialFunction,
    start: number,
  ) => Effect.Effect<Prepared>,
  partials: { readonly matched: PartialFunction; readonly unmatched: PartialFunction },
): SideRunner =>
(entry, kind, modules, mutantId, withFault) => {
  const driver = lookupOrThrow(table, entry.exportName, 'behaviour driver')
  const matching = kind === 'equivalence-partial-matching' || kind === 'divergence-two-fibers'
  const pf = matching ? partials.matched : partials.unmatched
  if (kind === 'divergence-two-fibers') {
    return raceSide(
      prepare(modules, driver.build, pf, driver.case.start),
      driver.case.race[withFault ? 'mutant' : 'original'],
      mutantId,
      withFault,
    )
  }
  return equivalenceSide(
    prepare(modules, driver.build, pf, driver.case.start),
    matching ? driver.case.matched : driver.case.unmatched,
    mutantId,
    withFault,
  )
}

const refPartialPrepare = <PartialFunction>(
  modules: Instrumented,
  build: (modules: Instrumented, state: Ref.Ref<number>, pf: PartialFunction) => Effect.Effect<Outcome, Failure>,
  pf: PartialFunction,
  start: number,
): Effect.Effect<Prepared> =>
  Effect.map(Ref.make(start), (ref): Prepared => ({ effect: build(modules, ref, pf), readState: () => Ref.get(ref) }))

const syncPartialPrepare = <PartialFunction>(
  modules: Instrumented,
  build: (
    modules: Instrumented,
    state: SynchronizedRef.SynchronizedRef<number>,
    pf: PartialFunction,
  ) => Effect.Effect<Outcome, Failure>,
  pf: PartialFunction,
  start: number,
): Effect.Effect<Prepared> =>
  Effect.map(
    SynchronizedRef.make(start),
    (ref): Prepared => ({ effect: build(modules, ref, pf), readState: () => SynchronizedRef.get(ref) }),
  )

const refModifySomeSide = partialSideFor(REF_MODIFY_SOME_DRIVERS, refPartialPrepare, {
  matched: matchedModify,
  unmatched: unmatchedModify,
})
const refUpdateSomeSide = partialSideFor(REF_UPDATE_SOME_DRIVERS, refPartialPrepare, {
  matched: matchedUpdate,
  unmatched: unmatchedUpdate,
})
const syncModifySomeSide = partialSideFor(SYNC_MODIFY_SOME_DRIVERS, syncPartialPrepare, {
  matched: matchedModify,
  unmatched: unmatchedModify,
})
const syncUpdateSomeSide = partialSideFor(SYNC_UPDATE_SOME_DRIVERS, syncPartialPrepare, {
  matched: matchedUpdate,
  unmatched: unmatchedUpdate,
})

const semaphoreSide: SideRunner = (entry, kind, modules, mutantId, withFault) => {
  const driver = lookupOrThrow(SEMAPHORE_DRIVERS, entry.exportName, 'behaviour driver')
  if (kind === 'divergence-max-concurrency') {
    const peakPrepare: Effect.Effect<Prepared> = Effect.gen(function*() {
      const sem = yield* Semaphore.make(1)
      const inside = yield* Ref.make(0)
      const peak = yield* Ref.make(0)
      const arrivals = yield* Ref.make(0)
      const gate = yield* Deferred.make<void>()
      const body: Effect.Effect<number> = Effect.gen(function*() {
        yield* Ref.update(inside, (n) => n + 1)
        const current = yield* Ref.get(inside)
        yield* Ref.update(peak, (seen) => Math.max(seen, current))
        yield* Ref.update(arrivals, (n) => n + 1)
        yield* Deferred.await(gate)
        return yield* Effect.as(Ref.update(inside, (n) => n - 1), RESULT)
      })
      return {
        effect: driver.build(modules, sem, body),
        readState: () => Ref.get(peak),
        settle: settleArrivals(arrivals, gate),
      }
    })
    return raceSide(peakPrepare, SEMAPHORE_CASE.peak[withFault ? 'mutant' : 'original'], mutantId, withFault)
  }
  const failing = kind === 'equivalence-failure'
  const inner: Effect.Effect<number> = failing ? Effect.die(FAILURE) : Effect.succeed(RESULT)
  return equivalenceSide(
    Effect.map(Semaphore.make(1), (sem): Prepared => ({
      effect: driver.build(modules, sem, inner),
      readState: () => freePermits(sem),
    })),
    failing ? SEMAPHORE_CASE.equivalenceFailure : SEMAPHORE_CASE.equivalenceSuccess,
    mutantId,
    withFault,
  )
}

const regionSide: SideRunner = (entry, kind, modules, mutantId, withFault) => {
  const driver = lookupOrThrow(REGION_DRIVERS, entry.exportName, 'behaviour driver')
  if (kind === 'divergence-interrupt-region') {
    const interruptPrepare: Effect.Effect<InterruptPrepared> = Effect.gen(function*() {
      const marker = yield* Ref.make(false)
      const started = yield* Deferred.make<void>()
      const gate = yield* Deferred.make<void>()
      const inner: Effect.Effect<number> = Effect.flatMap(
        Deferred.succeed(started, undefined),
        () => Effect.flatMap(Deferred.await(gate), () => Effect.as(Ref.set(marker, true), RESULT)),
      )
      return {
        region: driver.interruptedBuild(modules, inner),
        startSignal: Deferred.await(started),
        resume: Deferred.succeed(gate, undefined),
        readState: () => Ref.get(marker),
      }
    })
    return interruptSide(
      interruptPrepare,
      driver.case.interrupt[withFault ? 'mutant' : 'original'],
      mutantId,
      withFault,
    )
  }
  const failing = kind === 'equivalence-failure'
  const inner: Effect.Effect<number> = failing ? Effect.die(FAILURE) : Effect.succeed(RESULT)
  return observedSide(
    twiceObserved(Effect.succeed({ effect: driver.build(modules, inner) })),
    failing ? driver.case.equivalenceFailure : driver.case.equivalenceSuccess,
    mutantId,
    withFault,
  )
}

const closedFinalizerSideFor = (table: Readonly<Record<string, ClosedFinalizerDriver>>): SideRunner =>
(
  entry,
  kind,
  modules,
  mutantId,
  withFault,
) => {
  const driver = lookupOrThrow(table, entry.exportName, 'behaviour driver')
  if (kind === 'divergence-interrupt-finalizer' || kind === 'divergence-interrupt-handler') {
    const interruptPrepare: Effect.Effect<InterruptPrepared> = Effect.gen(function*() {
      const closed = yield* Ref.make(false)
      const started = yield* Deferred.make<void>()
      const gate = yield* Deferred.make<void>()
      return {
        region: driver.build(modules, suspendingInner(started, gate), closed),
        startSignal: Deferred.await(started),
        resume: Deferred.succeed(gate, undefined),
        readState: () => Ref.get(closed),
      }
    })
    return interruptSide(
      interruptPrepare,
      driver.case.interrupt[withFault ? 'mutant' : 'original'],
      mutantId,
      withFault,
    )
  }
  const failing = kind === 'equivalence-failure'
  const inner: Effect.Effect<number> = failing ? Effect.die(FAILURE) : Effect.succeed(RESULT)
  return equivalenceSide(
    Effect.map(Ref.make(false), (closed): Prepared => ({
      effect: driver.build(modules, inner, closed),
      readState: () => Ref.get(closed),
    })),
    failing ? driver.case.equivalenceFailure : driver.case.equivalenceSuccess,
    mutantId,
    withFault,
  )
}

const ensuringSide = closedFinalizerSideFor(ENSURING_DRIVERS)
const onExitSide = closedFinalizerSideFor(ON_EXIT_DRIVERS)
const onErrorSide = closedFinalizerSideFor(ON_ERROR_DRIVERS)
const onInterruptSide = closedFinalizerSideFor(ON_INTERRUPT_DRIVERS)

const acquireReleaseSide: SideRunner = (entry, kind, modules, mutantId, withFault) => {
  if (entry.exportName === 'acquireReleaseDivergence') {
    const interruptPrepare: Effect.Effect<InterruptPrepared> = Effect.gen(function*() {
      const acquired = yield* Ref.make(false)
      const closed = yield* Ref.make(false)
      const done = yield* Deferred.make<boolean>()
      return {
        region: Effect.scoped(
          requireExport(modules.finalizer.acquireReleaseDivergence, 'acquireReleaseDivergence')(acquired, done, closed),
        ),
        startSignal: awaitFlag(acquired),
        resume: Deferred.succeed(done, true),
        readState: () =>
          Effect.map(
            Effect.all([Ref.get(acquired), Ref.get(closed)]),
            ([flag, isClosed]) => ({ acquired: flag, closed: isClosed }),
          ),
      }
    })
    return interruptSide(
      interruptPrepare,
      ACQUIRE_DIVERGENCE_CASE[withFault ? 'mutant' : 'original'],
      mutantId,
      withFault,
    )
  }
  const driver = lookupOrThrow(ACQUIRE_RELEASE_DRIVERS, entry.exportName, 'behaviour driver')
  const failing = kind === 'equivalence-failure'
  return equivalenceSide(
    Effect.map(Ref.make(false), (closed): Prepared => {
      const bracket = driver.build(modules, closed)
      return { effect: failing ? failingWith(bracket) : bracket, readState: () => Ref.get(closed) }
    }),
    failing ? driver.case.equivalenceFailure : driver.case.equivalenceSuccess,
    mutantId,
    withFault,
  )
}

const acquireUseReleaseSide: SideRunner = (entry, kind, modules, mutantId, withFault) => {
  const driver = lookupOrThrow(ACQUIRE_USE_RELEASE_DRIVERS, entry.exportName, 'behaviour driver')
  if (kind === 'divergence-interrupt-use') {
    const interruptPrepare: Effect.Effect<InterruptPrepared> = Effect.gen(function*() {
      const closed = yield* Ref.make(false)
      const started = yield* Deferred.make<void>()
      const gate = yield* Deferred.make<void>()
      const use = (acquired: number): Effect.Effect<number> =>
        Effect.flatMap(Deferred.succeed(started, undefined), () => Effect.map(Deferred.await(gate), () => acquired))
      return {
        region: driver.build(modules, use, closed),
        startSignal: Deferred.await(started),
        resume: Deferred.succeed(gate, undefined),
        readState: () => Ref.get(closed),
      }
    })
    return interruptSide(
      interruptPrepare,
      ACQUIRE_USE_RELEASE_CASE.interrupt[withFault ? 'mutant' : 'original'],
      mutantId,
      withFault,
    )
  }
  const failing = kind === 'equivalence-failure'
  const use: (acquired: number) => Effect.Effect<number> = failing
    ? () => Effect.die(FAILURE)
    : (acquired) => Effect.succeed(acquired + 1)
  return equivalenceSide(
    Effect.map(Ref.make(false), (closed): Prepared => ({
      effect: driver.build(modules, use, closed),
      readState: () => Ref.get(closed),
    })),
    failing ? ACQUIRE_USE_RELEASE_CASE.equivalenceFailure : ACQUIRE_USE_RELEASE_CASE.equivalenceSuccess,
    mutantId,
    withFault,
  )
}

const nestedCoveredSide: SideRunner = (entry, kind, modules, mutantId, withFault) => {
  const driver = lookupOrThrow(NESTED_COVERED_DRIVERS, entry.exportName, 'behaviour driver')
  const failing = kind === 'equivalence-failure'
  const inner: Effect.Effect<number> = failing ? Effect.die(FAILURE) : Effect.succeed(RESULT)
  return equivalenceSide(
    Effect.map(Ref.make(false), (flag): Prepared => ({
      effect: driver.build(modules, inner, flag),
      readState: () => Ref.get(flag),
    })),
    failing ? driver.case.equivalenceFailure : driver.case.equivalenceSuccess,
    mutantId,
    withFault,
  )
}

const SPECIAL_SIDE_RUNNERS: Readonly<Record<string, SideRunner>> = {
  leaderLockScopeClose: closedFinalizerSideFor({ leaderLockScopeClose: LEADER_LOCK_DRIVER }),
  nestedCoveredCalls: nestedCoveredSide,
}

const SIDE_RUNNERS: Readonly<Record<string, SideRunner>> = {
  'Ref:modify': refPlainSide,
  'Ref:update': refPlainSide,
  'Ref:updateAndGet': refPlainSide,
  'Ref:getAndUpdate': refPlainSide,
  'SynchronizedRef:modify': syncPlainSide,
  'SynchronizedRef:update': syncPlainSide,
  'SynchronizedRef:updateAndGet': syncPlainSide,
  'SynchronizedRef:getAndUpdate': syncPlainSide,
  'Ref:modifySome': refModifySomeSide,
  'Ref:updateSome': refUpdateSomeSide,
  'SynchronizedRef:modifySome': syncModifySomeSide,
  'SynchronizedRef:updateSome': syncUpdateSomeSide,
  'Semaphore:withPermits': semaphoreSide,
  'Semaphore:withPermit': semaphoreSide,
  'Effect:uninterruptible': regionSide,
  'Effect:uninterruptibleMask': regionSide,
  'Effect:ensuring': ensuringSide,
  'Effect:onExit': onExitSide,
  'Effect:onError': onErrorSide,
  'Effect:onInterrupt': onInterruptSide,
  'Effect:acquireRelease': acquireReleaseSide,
  'Effect:acquireUseRelease': acquireUseReleaseSide,
}

interface Subject {
  readonly entry: ShapeEntry
  readonly kind: ScenarioKind
}

const sideFor = (subject: Subject): ScenarioSides => {
  const entry = subject.entry
  const special = SPECIAL_SIDE_RUNNERS[entry.exportName]
  const runner = special === undefined
    ? lookupOrThrow(SIDE_RUNNERS, `${entry.module}:${entry.operation}`, 'shape behaviour')
    : special
  const mutantIds = mutantIdsFor(entry)
  const modules = harnessOf().modules
  return {
    withoutFault: runner(entry, subject.kind, modules, mutantIds.at(0) ?? '', false),
    withFault: mutantIds.map((mutantId) => runner(entry, subject.kind, modules, mutantId, true)),
  }
}

const scenarioEntries = (): readonly ShapeEntry[] => shapes.filter((entry) => entry.scenarios.length > 0)

const exportLineRange = (
  content: string,
  exportName: string,
): { readonly firstLine: number; readonly lastLine: number } => {
  const lines = content.split('\n')
  const marker = lines.findIndex((line) => line.startsWith(`export const ${exportName}`))
  if (marker === -1) {
    throw new Error(`the fixture has no export ${exportName}`)
  }
  const after = lines.slice(marker + 1).findIndex((line) => line.startsWith('export '))
  return { firstLine: marker + 1, lastLine: after === -1 ? lines.length : marker + after + 1 }
}

const operationCallSite = (
  content: string,
  entry: ShapeEntry,
): { readonly line: number; readonly column: number } => {
  const range = exportLineRange(content, entry.exportName)
  const lines = content.split('\n')
  const marker = `${entry.module}.${entry.operation}(`
  const at = lines.findIndex((line, index) => {
    const sourceLine = index + 1
    return range.firstLine <= sourceLine && sourceLine <= range.lastLine && line.includes(marker)
  })
  if (at === -1) {
    throw new Error(`${entry.file} ${entry.exportName} has no ${entry.module}.${entry.operation} call`)
  }
  const line = lines.at(at) ?? ''
  return { line: at, column: line.indexOf(marker) + 1 }
}

const mutantsInside = (entry: ShapeEntry): readonly Mutant[] => {
  const current = harnessOf()
  const source = current.fixtureSources[entry.file]
  if (source === undefined) {
    throw new Error(`${entry.file} was never instrumented`)
  }
  const range = exportLineRange(source, entry.exportName)
  const inside = current.mutants.filter((mutant) => {
    const sourceLine = mutant.location.start.line + 1
    return mutant.mutatorName === entry.mutator &&
      mutant.fileName === entry.file &&
      range.firstLine <= sourceLine &&
      sourceLine <= range.lastLine
  })
  if (inside.length === entry.expectedMutants) {
    return inside
  }
  const callSite = operationCallSite(source, entry)
  const owned = inside.filter((mutant) =>
    mutant.location.start.line === callSite.line && mutant.location.start.column === callSite.column
  )
  if (owned.length === 0) {
    throw new Error(
      `${entry.file} ${entry.exportName} matched none of ${inside.length} mutants at its ${entry.module}.${entry.operation} call`,
    )
  }
  return owned
}

const mutantIdsFor = (entry: ShapeEntry): readonly string[] => {
  const located = mutantsInside(entry)
  if (located.length === 0) {
    throw new Error(`${entry.file} ${entry.exportName} mapped to no mutants`)
  }
  return located.map((mutant) => mutant.id)
}

const mappingMismatches = (): readonly string[] => {
  const mismatches: string[] = []
  for (const entry of scenarioEntries()) {
    const found = mutantsInside(entry).length
    if (found !== entry.expectedMutants) {
      mismatches.push(
        `${entry.file} ${entry.exportName} promised ${entry.expectedMutants} mutants and produced ${found}`,
      )
    }
  }
  return mismatches
}

const coverageReport = (): {
  readonly live: readonly string[]
  readonly notLive: readonly string[]
  readonly shapesPerFault: Record<string, number>
} => {
  const entries = scenarioEntries()
  return {
    live: [...LIVE].sort(),
    notLive: [...new Set(entries.map((entry) => entry.mutator))].filter((name) => LIVE.includes(name) === false),
    shapesPerFault: Object.fromEntries(
      LIVE.map((name) => [name, entries.filter((entry) => entry.mutator === name).length]),
    ),
  }
}

const MODULE_SUBJECT: Record<Module, string> = {
  Ref: 'ref',
  SynchronizedRef: 'synchronized ref',
  Semaphore: 'semaphore',
  Effect: 'effect',
}

const FORM_SUBJECT: Record<Form, string> = {
  'data-first': 'data-first form',
  'data-last-pipe-arg': 'data-last pipe argument',
  'data-last-pipe-method': 'data-last pipe method',
  'data-last-immediate': 'data-last immediate call',
  'data-last-outside-pipe': 'data-last position outside a pipe',
}

const KIND_SUBJECT: Record<ScenarioKind, string> = {
  'equivalence-success': 'keeps its single-fiber result on the success path',
  'equivalence-failure': 'keeps its single-fiber result on the failure path',
  'equivalence-partial-matching': 'keeps its single-fiber result when the partial function matches',
  'equivalence-partial-non-matching': 'keeps its single-fiber result when the partial function does not match',
  'divergence-two-fibers': 'loses the update when two fibers race',
  'divergence-max-concurrency': 'admits two fibers into the guarded section at once',
  'divergence-interrupt-region': 'stops the region when the fiber is interrupted inside it',
  'divergence-interrupt-finalizer': 'skips the finalizer when the fiber is interrupted',
  'divergence-interrupt-handler': 'skips the handler when the fiber is interrupted',
  'divergence-interrupt-acquire': 'leaves the resource held when the acquire is interrupted',
  'divergence-interrupt-use': 'skips the release when the use is interrupted',
}

const subjectFor = (entry: ShapeEntry, kind: ScenarioKind): `${string} ${string}` =>
  `A ${MODULE_SUBJECT[entry.module]} ${entry.operation} in ${FORM_SUBJECT[entry.form]} ${KIND_SUBJECT[kind]}`

const loadModule = <A>(url: URL, isModule: (u: unknown) => u is A): Effect.Effect<A, FixtureImportError> =>
  Effect.filterOrFail(
    Effect.tryPromise({
      try: () => import(url.href),
      catch: () => FixtureImportError.make({ url: url.href }),
    }),
    isModule,
    () => FixtureImportError.make({ url: url.href }),
  )

const loadInstrumentedModules: Effect.Effect<Instrumented, FixtureImportError> = Effect.gen(function*() {
  const atomic = yield* loadModule(new URL('effect-concurrency/atomic-update-split.ts', SCRATCH_URL), isAtomicModule)
  const synchronization = yield* loadModule(
    new URL('effect-concurrency/synchronization-removal.ts', SCRATCH_URL),
    isSynchronizationRemovalModule,
  )
  const finalizer = yield* loadModule(
    new URL('effect-concurrency/finalizer-escape.ts', SCRATCH_URL),
    isFinalizerEscapeModule,
  )
  const refusals = yield* loadModule(new URL('effect-concurrency/refusals.ts', SCRATCH_URL), isRefusalsModule)
  return { atomic, synchronization, finalizer, refusals }
})

const removeScratch: Effect.Effect<void, PlatformError.PlatformError, FileSystem.FileSystem> = Effect.flatMap(
  FileSystem.FileSystem,
  (fs) => fs.remove(filePathOf(SCRATCH_URL), { recursive: true, force: true }),
)

const buildHarness = Effect.gen(function*() {
  const fs = yield* FileSystem.FileSystem
  const sources = yield* Effect.forEach(
    FIXTURE_MODULES,
    (name) =>
      Effect.map(fs.readFileString(filePathOf(new URL(name, FIXTURE_URL))), (content) => ({
        name: `effect-concurrency/${name}`,
        content,
      })),
  )
  const supportSources = yield* Effect.forEach(
    SUPPORT_MODULES,
    (name) =>
      Effect.map(fs.readFileString(filePathOf(new URL(name, FIXTURE_URL))), (content) => ({
        name: `effect-concurrency/${name}`,
        content,
      })),
  )
  const result: InstrumentResult = yield* instrument(
    [
      ...sources.map((source) => ({ ...source, mutate: true })),
      ...supportSources.map((source) => ({ ...source, mutate: false })),
    ],
    { ignorers: [], excludedMutations: [], optInMutations: [...LIVE] },
  )
  yield* fs.remove(filePathOf(SCRATCH_URL), { recursive: true, force: true })
  yield* fs.makeDirectory(filePathOf(new URL('effect-concurrency/', SCRATCH_URL)), { recursive: true })
  yield* Effect.forEach(
    result.files,
    (file) => fs.writeFileString(filePathOf(new URL(file.name, SCRATCH_URL)), file.content),
  )
  const modules = yield* loadInstrumentedModules
  const fixtureSources = Object.fromEntries(
    sources.map((source): readonly [string, string] => [source.name, source.content]),
  )
  return { mutants: result.mutants, fixtureSources, modules }
})

beforeAll(() =>
  Effect.runPromise(
    Effect.map(Effect.provide(buildHarness, NodeFileSystem.layer), (built) => {
      harness = built
    }),
  )
)

afterAll(() => Effect.runPromise(Effect.provide(removeScratch, NodeFileSystem.layer)))

const Feature = makeFeature({ it, layer })

Feature('Keeping single-fiber behaviour while exposing races in Effect concurrency')
  .withLayer(Layer.empty)
  .body(({ scenario }) => {
    scenario(
      'Every shape with scenarios maps to exactly the mutants its entry promises',
      Gherkin.Do.pipe(
        Given('the frozen shape table')('mismatches', () => Effect.sync(mappingMismatches)),
        Then('every shape finds exactly the mutants inside its own export')(({ mismatches }) =>
          Effect.sync(() => expect(mismatches).toStrictEqual([]))
        ),
      ),
    )

    scenario(
      'Every live opt-in fault covers the shapes that name it',
      Gherkin.Do.pipe(
        Given('the live opt-in registry')('coverage', () => Effect.succeed(coverageReport())),
        Then('every opt-in fault is live and every naming shape carries scenarios')(({ coverage }) =>
          Effect.sync(() => {
            expect(coverage.live).toStrictEqual(['AtomicUpdateSplit', 'FinalizerEscape', 'SynchronizationRemoval'])
            expect(coverage.notLive).toStrictEqual([])
            expect(coverage.shapesPerFault).toStrictEqual({
              AtomicUpdateSplit: 37,
              FinalizerEscape: 19,
              SynchronizationRemoval: 11,
            })
          })
        ),
      ),
    )

    for (const entry of shapes) {
      for (const kind of entry.scenarios) {
        scenario(
          subjectFor(entry, kind),
          Gherkin.Do.pipe(
            Given('the concurrency shape and its planted fault')('subject', () => Effect.succeed({ entry, kind })),
            When('the shape runs without the fault and then with it')(
              'report',
              (s) =>
                Effect.flatMap(
                  sideFor(s.subject).withoutFault.run,
                  (withoutFault) =>
                    Effect.map(
                      Effect.forEach(sideFor(s.subject).withFault, (side) => side.run),
                      (withFault) => ({ withoutFault, withFault }),
                    ),
                ),
            ),
            Then('each run matches the outcome this specification states')((s) =>
              Effect.sync(() => {
                const sides = sideFor(s.subject)
                expect(s.report.withoutFault, 'without the fault').toStrictEqual(sides.withoutFault.expected)
                expect(s.report.withFault, 'with each fault active one at a time').toStrictEqual(
                  sides.withFault.map((side) => side.expected),
                )
              })
            ),
          ),
        )
      }
    }
  })
