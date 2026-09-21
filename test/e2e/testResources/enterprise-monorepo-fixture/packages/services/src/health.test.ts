import { beforeEach, describe, expect, test, vi } from 'vitest'

import { isLaunchable } from '@enterprise/core'
import * as clock from './clock.js'
import { gateStatus, launchState, probe } from './health.js'

describe('probe', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  test('succeeds on the first healthy check', async () => {
    const result = await probe(async () => true, { attempts: 3 })
    expect(result).toEqual({ healthy: true, attemptsUsed: 1 })
  })

  test('reports the attempt that first succeeded', async () => {
    let calls = 0
    const result = await probe(() => {
      calls += 1
      return Promise.resolve(calls >= 3)
    }, { attempts: 4, delayMs: 1 })
    expect(result).toEqual({ healthy: true, attemptsUsed: 3 })
  })

  test('fails after exhausting the attempts', async () => {
    const result = await probe(async () => false, { attempts: 2, delayMs: 1 })
    expect(result).toEqual({ healthy: false, attemptsUsed: 2 })
  })

  test('sleeps between attempts but never after the last one', async () => {
    const spy = vi.spyOn(clock, 'sleep').mockResolvedValue(undefined)
    await probe(async () => false, { attempts: 3, delayMs: 2 })
    expect(spy.mock.calls).toEqual([[2], [2]])
  })

  test('propagates client rejection instead of swallowing it', async () => {
    const failure = new Error('probe socket reset')
    await expect(probe(() => Promise.reject(failure), { attempts: 2 })).rejects.toThrow('probe socket reset')
  })
})

describe('gateStatus', () => {
  test('reports off for an absent config', () => {
    expect(gateStatus(undefined)).toBe('off')
  })

  test('reports off for a disabled config', () => {
    expect(gateStatus({ enabled: false, canaryPercent: 50 })).toBe('off')
  })

  test('reports partial for an enabled canary', () => {
    expect(gateStatus({ enabled: true, canaryPercent: 10 })).toBe('partial')
  })

  test('reports steady for a fully rolled out config', () => {
    expect(gateStatus({ enabled: true, canaryPercent: 0 })).toBe('steady')
  })
})

describe('launchState', () => {
  test('uses the shared core gate for the launch decision', () => {
    expect(launchState({ enabled: true, canaryPercent: 5 })).toBe('launching')
    expect(launchState({ enabled: false, canaryPercent: 5 })).toBe('holding')
    expect(isLaunchable({ enabled: true, canaryPercent: 5 })).toBe(true)
  })
})
