import { Effect, Ref } from 'effect'

// @stryker-expect next-line CompileError(TS2355): BlockStatement
export function withRelease<A>(closed: Ref.Ref<boolean>, region: Effect.Effect<A>): Effect.Effect<A> {
  return Effect.ensuring(region, Ref.set(closed, true))
}

// @stryker-expect file KilledOrTimeout: all
