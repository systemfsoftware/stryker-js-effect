import * as Effect from 'effect/Effect'
import type * as OxcModule from 'oxc-parser'

export type Oxc = typeof OxcModule

let oxc: Oxc | undefined

export const loadOxc: Effect.Effect<Oxc> = Effect.gen(function*() {
  if (oxc === undefined) {
    // Lazy: importing this package must not construct a parser.
    oxc = yield* Effect.promise(() => import('oxc-parser'))
  }
  return oxc
})
