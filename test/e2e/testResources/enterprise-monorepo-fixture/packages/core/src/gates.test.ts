import { describe, expect, test } from 'vitest'

import { gateFor, isLaunchable, regionLabel, shouldSample } from './gates.js'

describe('isLaunchable', () => {
  test('requires an enabled config with a positive canary', () => {
    expect(isLaunchable({ enabled: true, canaryPercent: 5 })).toBe(true)
  })

  test('rejects a disabled config', () => {
    expect(isLaunchable({ enabled: false, canaryPercent: 5 })).toBe(false)
  })

  test('rejects a zero canary', () => {
    expect(isLaunchable({ enabled: true, canaryPercent: 0 })).toBe(false)
  })
})

describe('gateFor', () => {
  test('disabled configs never launch', () => {
    expect(gateFor({ enabled: false, canaryPercent: 100 })).toBe('disabled')
  })

  test('full rollout at one hundred percent', () => {
    expect(gateFor({ enabled: true, canaryPercent: 100 })).toBe('full')
  })

  test('partial rollout stays on canary', () => {
    expect(gateFor({ enabled: true, canaryPercent: 25 })).toBe('canary')
  })
})

describe('regionLabel', () => {
  test('uses the configured region', () => {
    expect(regionLabel({ enabled: true, canaryPercent: 1, region: 'eu-west' })).toBe('eu-west')
  })

  test('falls back to the global label', () => {
    expect(regionLabel({ enabled: true, canaryPercent: 1 })).toBe('global')
  })
})

describe('shouldSample', () => {
  test('samples even seeds below the canary percent', () => {
    expect(shouldSample({ enabled: true, canaryPercent: 50 }, 48)).toBe(true)
  })

  test('rejects seeds at or above the canary percent', () => {
    expect(shouldSample({ enabled: true, canaryPercent: 50 }, 50)).toBe(false)
    expect(shouldSample({ enabled: true, canaryPercent: 50 }, 51)).toBe(false)
  })

  test('rejects odd seeds regardless of canary', () => {
    expect(shouldSample({ enabled: true, canaryPercent: 100 }, 3)).toBe(false)
  })

  test('never samples a disabled config', () => {
    expect(shouldSample({ enabled: false, canaryPercent: 100 }, 4)).toBe(false)
  })
})
