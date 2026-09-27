import { Effect, Ref } from 'effect'
import { describe, expect, test } from 'vitest'

import { withRelease } from './release.js'

describe.concurrent('Feature: Resource Release on Region Interruption', () => {
  describe.concurrent('Rule: A finalizer runs even when its region is interrupted', () => {
    test('Given an interrupted guarded region, When it ends, Then the release flag is closed', async () => {
      const closed = await Effect.runPromise(
        Effect.gen(function*() {
          const released = yield* Ref.make(false)
          yield* Effect.exit(withRelease(released, Effect.interrupt))
          return yield* Ref.get(released)
        }),
      )

      expect(closed).toBe(true)
    })
  })
})
