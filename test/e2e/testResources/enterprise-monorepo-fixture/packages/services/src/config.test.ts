import { describe, expect, test } from 'vitest'

import { RETRIES, TIMEOUT_MS } from './config.js'

describe('runtime config', () => {
  test('exposes the awaited defaults at module scope', () => {
    expect(TIMEOUT_MS).toBe(800)
    expect(RETRIES).toBe(2)
  })
})
