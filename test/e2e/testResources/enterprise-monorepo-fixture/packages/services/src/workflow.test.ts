import { describe, expect, test, vi } from 'vitest'

import { sleep } from './clock.js'
import { launchState, probe } from './health.js'

vi.mock('./clock.js', () => ({ sleep: vi.fn(async () => undefined) }))

describe('under the clock module mock', () => {
  test('the mocked boundary drives retries without real timers', async () => {
    const result = await probe(async () => false, { attempts: 3, delayMs: 999 })
    expect(result).toEqual({ healthy: false, attemptsUsed: 3 })
    expect(vi.mocked(sleep)).toHaveBeenCalledTimes(2)
    expect(vi.mocked(sleep)).toHaveBeenCalledWith(999)
  })

  test('the mock does not alter shared core decisions', () => {
    expect(launchState({ enabled: true, canaryPercent: 1 })).toBe('launching')
    expect(launchState({ enabled: false, canaryPercent: 1 })).toBe('holding')
  })
})
