import { beforeEach, describe, expect, test, vi } from 'vitest'

import { isLaunchable } from '@enterprise/core'
import * as clock from './clock.js'
import { gateStatus, launchState, probe } from './health.js'

describe('Feature: Asynchronous Service Health Probing & Canary Rollout Status', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  describe('Rule: Health probing attempts retries until healthy or attempts are exhausted', () => {
    test('Given a service that is immediately healthy, When probed, Then it succeeds on the initial attempt', async () => {
      const result = await probe(async () => true, { attempts: 3 })
      expect(result).toEqual({ healthy: true, attemptsUsed: 1 })
    })

    test('Given a service that becomes healthy after intermittent failures, When probed, Then it reports the successful attempt count', async () => {
      let calls = 0
      const result = await probe(() => {
        calls += 1
        return Promise.resolve(calls >= 3)
      }, { attempts: 4, delayMs: 1 })
      expect(result).toEqual({ healthy: true, attemptsUsed: 3 })
    })

    test('Given a continuously unhealthy service, When probed, Then it fails after exhausting configured attempts', async () => {
      const result = await probe(async () => false, { attempts: 2, delayMs: 1 })
      expect(result).toEqual({ healthy: false, attemptsUsed: 2 })
    })

    test('Given an unhealthy service, When probed with a retry delay, Then it waits for the configured interval between attempts', async () => {
      const spy = vi.spyOn(clock, 'sleep').mockResolvedValue(undefined)
      await probe(async () => false, { attempts: 3, delayMs: 2 })
      expect(spy.mock.calls).toEqual([
        [2],
        [2],
        [2],
      ])
    })

    test('Given a probe check that throws an unexpected error, When probed, Then it propagates the rejection to the caller', async () => {
      const failure = new Error('probe socket reset')
      await expect(probe(() => Promise.reject(failure), { attempts: 2 })).rejects.toThrow('probe socket reset')
    })
  })

  describe('Rule: Gate status maps configuration presence and canary allocation to rollout states', () => {
    test('Given an absent feature configuration, When gate status is evaluated, Then it resolves to off', () => {
      expect(gateStatus(undefined)).toBe('off')
    })

    test('Given a disabled feature configuration, When gate status is evaluated, Then it resolves to off', () => {
      expect(gateStatus({ enabled: false, canaryPercent: 50 })).toBe('off')
    })

    test('Given an enabled configuration with partial canary traffic, When gate status is evaluated, Then it resolves to partial', () => {
      expect(gateStatus({ enabled: true, canaryPercent: 10 })).toBe('partial')
    })

    test('Given an enabled configuration with zero canary traffic, When gate status is evaluated, Then it resolves to steady', () => {
      expect(gateStatus({ enabled: true, canaryPercent: 0 })).toBe('steady')
    })
  })

  describe('Rule: Launch state delegates directly to core launchable rules', () => {
    test('Given enabled or disabled configs, When launch state is determined, Then it coordinates with core launchable decisions', () => {
      expect(launchState({ enabled: true, canaryPercent: 5 })).toBe('launching')
      expect(launchState({ enabled: false, canaryPercent: 5 })).toBe('holding')
      expect(isLaunchable({ enabled: true, canaryPercent: 5 })).toBe(true)
    })
  })
})
