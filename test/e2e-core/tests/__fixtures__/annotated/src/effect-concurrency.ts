import { Effect, Ref, Semaphore } from 'effect'

// @stryker-expect next-line KilledOrTimeout: AtomicUpdateSplit, ArrowFunction, ArithmeticOperator
const bump = (ref: Ref.Ref<number>): Effect.Effect<void> => Ref.update(ref, (n) => n + 1)

// @stryker-expect next-line KilledOrTimeout: ArrowFunction
const guarded = (sem: Semaphore.Semaphore, effect: Effect.Effect<number>): Effect.Effect<number> =>
  // @stryker-expect next-line KilledOrTimeout: SynchronizationRemoval
  Semaphore.withPermits(sem, 1, effect)

// @stryker-expect next-line KilledOrTimeout: ArrowFunction
const ensureClosed = (effect: Effect.Effect<number>, closed: Ref.Ref<boolean>): Effect.Effect<number> =>
  // @stryker-expect next-line KilledOrTimeout: FinalizerEscape, BooleanLiteral
  Effect.ensuring(effect, Ref.set(closed, true))

export type AnnotatedSampleDeclarations = typeof bump | typeof ensureClosed | typeof guarded
