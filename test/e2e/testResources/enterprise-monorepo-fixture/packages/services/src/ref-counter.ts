import { Effect, Fiber, Ref } from 'effect'

// @stryker-expect next-line KilledOrTimeout: AtomicUpdateSplit, ArithmeticOperator
// @stryker-expect next-line CompileError(TS2345): ArrowFunction="() => undefined"
export const bump = (counter: Ref.Ref<number>): Effect.Effect<void> => Ref.update(counter, (n) => n + 1)

// @stryker-expect next-line CompileError(TS2345): ArrowFunction="() => undefined"
export const trackedBump = (counter: Ref.Ref<number>, closed: Ref.Ref<boolean>): Effect.Effect<void> =>
  // @stryker-expect next-line KilledOrTimeout: BooleanLiteral
  // @stryker-expect next-line Survived: FinalizerEscape
  Effect.ensuring(bump(counter), Ref.set(closed, true))

// @stryker-expect next-line CompileError(TS2345): ArrowFunction="() => undefined"
export const fanOut = (counter: Ref.Ref<number>, fibers: number): Effect.Effect<void> =>
  Effect.flatMap(
    // @stryker-expect next-line CompileError(TS2769): ObjectLiteral="{}"
    // @stryker-expect next-line CompileError(TS2345): ArrowFunction="() => undefined"
    Effect.forEach(Array.from({ length: fibers }), () => Effect.forkChild(bump(counter))),
    // @stryker-expect next-line CompileError(TS2322): ArrowFunction="() => undefined"
    (forks) => Fiber.joinAll(forks),
  )
