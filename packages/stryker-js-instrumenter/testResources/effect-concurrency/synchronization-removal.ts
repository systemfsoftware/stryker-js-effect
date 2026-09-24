import { Effect, pipe, Semaphore } from 'effect'

export const withPermitsDataFirst = (sem: Semaphore.Semaphore, effect: Effect.Effect<number>) =>
  Semaphore.withPermits(sem, 1, effect)

export const withPermitsPipeArg = (sem: Semaphore.Semaphore, effect: Effect.Effect<number>) =>
  pipe(effect, Semaphore.withPermits(sem, 1))

export const withPermitsPipeMethod = (sem: Semaphore.Semaphore, effect: Effect.Effect<number>) =>
  effect.pipe(Semaphore.withPermits(sem, 1))

export const withPermitsImmediate = (sem: Semaphore.Semaphore, effect: Effect.Effect<number>) =>
  Semaphore.withPermits(sem, 1)(effect)

export const withPermitDataFirst = (sem: Semaphore.Semaphore, effect: Effect.Effect<number>) =>
  Semaphore.withPermit(sem, effect)

export const withPermitPipeArg = (sem: Semaphore.Semaphore, effect: Effect.Effect<number>) =>
  pipe(effect, Semaphore.withPermit(sem))

export const withPermitPipeMethod = (sem: Semaphore.Semaphore, effect: Effect.Effect<number>) =>
  effect.pipe(Semaphore.withPermit(sem))

export const uninterruptibleCall = (effect: Effect.Effect<number>) => Effect.uninterruptible(effect)

export const uninterruptiblePipedReference = (effect: Effect.Effect<number>) => effect.pipe(Effect.uninterruptible)

export const uninterruptibleMaskRegion = (effect: Effect.Effect<number>) =>
  Effect.uninterruptibleMask((restore) => restore(effect))
