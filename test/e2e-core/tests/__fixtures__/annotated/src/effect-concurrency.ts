import { Effect, Ref, Semaphore } from 'effect'

// @stryker-expect next-line KilledOrTimeout: AtomicUpdateSplit, ArrowFunction, ArithmeticOperator
const bump = (ref: Ref.Ref<number>): Effect.Effect<void> => Ref.update(ref, (n) => n + 1)

// @stryker-expect next-line KilledOrTimeout: SynchronizationRemoval, ArrowFunction
const guarded = (sem: Semaphore.Semaphore, effect: Effect.Effect<number>): Effect.Effect<number> =>
  Semaphore.withPermits(sem, 1, effect)

// @stryker-expect next-line KilledOrTimeout: FinalizerEscape, ArrowFunction, BooleanLiteral
const ensureClosed = (effect: Effect.Effect<number>, closed: Ref.Ref<boolean>): Effect.Effect<number> =>
  Effect.ensuring(effect, Ref.set(closed, true))

export type AnnotatedSampleDeclarations = typeof bump | typeof ensureClosed | typeof guarded
