import { Effect } from 'effect'

import { NotFound } from './not-found.schema.js'

// @stryker-expect next-line KilledOrTimeout: ArrowFunction
const lookup = (found: boolean): Effect.Effect<number, NotFound> =>
  found ? Effect.succeed(1) : Effect.fail(new NotFound())

// @stryker-expect next-line KilledOrTimeout: ArrowFunction, RecoveryRemoval, StringLiteral
const withFallback = (found: boolean) => lookup(found).pipe(Effect.catchTag('NotFound', () => Effect.succeed(0)))

export type AnnotatedErrorChannelDeclarations = typeof lookup | typeof withFallback
