import { Effect } from 'effect'

export class NotFound {
  readonly _tag = 'NotFound'
}

export const lookup = (found: boolean): Effect.Effect<number, NotFound> =>
  found ? Effect.succeed(42) : Effect.fail(new NotFound())

export const withFallback = (found: boolean) => lookup(found).pipe(Effect.catchTag('NotFound', () => Effect.succeed(0)))
