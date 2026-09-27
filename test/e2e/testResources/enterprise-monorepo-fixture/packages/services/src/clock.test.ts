import { describe, expect, test } from 'vitest'

import { reportDeferredFailure, sleep } from './clock.js'

describe('Feature: Asynchronous Clock and Timer Primitives', () => {
  describe('Rule: Non-blocking sleep returns an empty promise resolution after elapsed delay', () => {
    test('Given a millisecond duration, When awaited, Then the promise resolves without leaking values', async () => {
      await expect(sleep(1)).resolves.toBeUndefined()
    })
  })

  describe('Rule: A deferred failure report stays outside the test call path', () => {
    test('Given no deferred failure, When reported, Then nothing escapes to the process', async () => {
      const reported = reportDeferredFailure(false)
      await Promise.resolve()
      expect(reported).toBeUndefined()
    })
  })
})
