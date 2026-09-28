import { Effect, Ref } from 'effect'
import { describe, expect, test } from 'vitest'

import { fanOut, trackedBump } from './ref-counter.js'

describe.concurrent('Feature: Atomic counter helpers', () => {
  test('Given concurrent bump fibers, When they all join, Then every bump is counted', async () => {
    const counter = await Effect.runPromise(Ref.make(0))
    await Effect.runPromise(fanOut(counter, 16))
    expect(await Effect.runPromise(Ref.get(counter))).toBe(16)
  })

  test('Given a tracked bump, When it settles, Then the completion flag is set', async () => {
    const counter = await Effect.runPromise(Ref.make(0))
    const closed = await Effect.runPromise(Ref.make(false))
    await Effect.runPromise(trackedBump(counter, closed))
    expect(await Effect.runPromise(Ref.get(closed))).toBe(true)
    expect(await Effect.runPromise(Ref.get(counter))).toBe(1)
  })
})
