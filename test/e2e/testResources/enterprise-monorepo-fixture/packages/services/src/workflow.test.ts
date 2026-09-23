import { describe, expect, test, vi } from 'vitest'

import { sleep } from './clock.js'
import { launchState, probe } from './health.js'

vi.mock('./clock.js', () => ({ sleep: vi.fn<(ms: number) => Promise<void>>(async () => undefined) }))

describe('Feature: Mocked Boundary Execution in Async Workflows', () => {
  describe('Rule: External timer boundaries can be mocked without mutating shared domain decisions', () => {
    test('Given an asynchronous probe under a mocked clock, When retries are exercised, Then timer side-effects are intercepted without real delay', async () => {
      const result = await probe(async () => false, { attempts: 3, delayMs: 999 })
      expect(result).toEqual({ healthy: false, attemptsUsed: 3 })
      expect(vi.mocked(sleep)).toHaveBeenCalledTimes(3)
      expect(vi.mocked(sleep)).toHaveBeenCalledWith(999)
    })

    test('Given the mocked clock module in the worker, When core launch decisions are evaluated, Then shared core logic remains intact and unmocked', () => {
      expect(launchState({ enabled: true, canaryPercent: 1 })).toBe('launching')
      expect(launchState({ enabled: false, canaryPercent: 1 })).toBe('holding')
    })
  })
})
