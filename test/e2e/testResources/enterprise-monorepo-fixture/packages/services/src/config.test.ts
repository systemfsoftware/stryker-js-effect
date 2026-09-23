import { describe, expect, test } from 'vitest'

import { RETRIES, TIMEOUT_MS } from './config.js'

describe('Feature: Asynchronously Initialized Runtime Configuration', () => {
  describe('Rule: Asynchronously loaded module defaults must be resolved and exposed at top-level module scope', () => {
    test('Given runtime configuration initialized via top-level await, When consumed by services, Then the expected default constants are resolved', () => {
      expect(TIMEOUT_MS).toBe(800)
      expect(RETRIES).toBe(2)
    })
  })
})
