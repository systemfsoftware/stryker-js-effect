import { Deferred, Effect, Exit, pipe, Ref, Scope } from 'effect'

export const ensuringDataFirst = (effect: Effect.Effect<number>, closed: Ref.Ref<boolean>) =>
  Effect.ensuring(effect, Ref.set(closed, true))

export const ensuringPipeArg = (effect: Effect.Effect<number>, closed: Ref.Ref<boolean>) =>
  pipe(effect, Effect.ensuring(Ref.set(closed, true)))

export const ensuringPipeMethod = (effect: Effect.Effect<number>, closed: Ref.Ref<boolean>) =>
  effect.pipe(Effect.ensuring(Ref.set(closed, true)))

export const onExitDataFirst = (effect: Effect.Effect<number>, closed: Ref.Ref<boolean>) =>
  Effect.onExit(effect, () => Ref.set(closed, true))

export const onExitPipeArg = (effect: Effect.Effect<number>, closed: Ref.Ref<boolean>) =>
  pipe(effect, Effect.onExit(() => Ref.set(closed, true)))

export const onExitPipeMethod = (effect: Effect.Effect<number>, closed: Ref.Ref<boolean>) =>
  effect.pipe(Effect.onExit(() => Ref.set(closed, true)))

export const onErrorDataFirst = (effect: Effect.Effect<number>, closed: Ref.Ref<boolean>) =>
  Effect.onError(effect, () => Ref.set(closed, true))

export const onErrorPipeArg = (effect: Effect.Effect<number>, closed: Ref.Ref<boolean>) =>
  pipe(effect, Effect.onError(() => Ref.set(closed, true)))

export const onErrorPipeMethod = (effect: Effect.Effect<number>, closed: Ref.Ref<boolean>) =>
  effect.pipe(Effect.onError(() => Ref.set(closed, true)))

export const onInterruptDataFirst = (effect: Effect.Effect<number>, closed: Ref.Ref<boolean>) =>
  Effect.onInterrupt(effect, () => Ref.set(closed, true))

export const onInterruptPipeArg = (effect: Effect.Effect<number>, closed: Ref.Ref<boolean>) =>
  pipe(effect, Effect.onInterrupt(() => Ref.set(closed, true)))

export const onInterruptPipeMethod = (effect: Effect.Effect<number>, closed: Ref.Ref<boolean>) =>
  effect.pipe(Effect.onInterrupt(() => Ref.set(closed, true)))

export const acquireReleaseTwoArg = (acquire: Effect.Effect<number>, closed: Ref.Ref<boolean>) =>
  Effect.acquireRelease(acquire, () => Ref.getAndSet(closed, true))

export const acquireReleaseThreeArg = (
  acquire: Effect.Effect<number>,
  closed: Ref.Ref<boolean>,
  options: { readonly interruptible?: boolean },
) => Effect.acquireRelease(acquire, () => Ref.getAndSet(closed, true), options)

export const acquireReleaseDivergence = (
  acquired: Ref.Ref<boolean>,
  done: Deferred.Deferred<boolean>,
  closed: Ref.Ref<boolean>,
) =>
  Effect.acquireRelease(
    Effect.flatMap(Ref.set(acquired, true), () => Deferred.await(done)),
    () => Ref.getAndSet(closed, true),
  )

export const acquireUseReleaseBrackets = (
  acquire: Effect.Effect<number>,
  use: (a: number) => Effect.Effect<number>,
  closed: Ref.Ref<boolean>,
) => Effect.acquireUseRelease(acquire, use, () => Ref.set(closed, true))

export const leaderLockScopeClose = (
  tryAcquire: Effect.Effect<boolean>,
  guarded: Effect.Effect<number>,
  closed: Ref.Ref<boolean>,
) =>
  Effect.uninterruptibleMask((restore) =>
    Effect.gen(function*() {
      const scope = yield* Scope.make()
      const acquired = yield* restore(tryAcquire).pipe(
        Scope.provide(scope),
        Effect.onError(() => Ref.set(closed, true)),
      )
      const result = yield* restore(guarded).pipe(
        Effect.ensuring(Effect.andThen(Scope.close(scope, Exit.void), Ref.set(closed, true))),
      )
      return { acquired, result }
    })
  )
