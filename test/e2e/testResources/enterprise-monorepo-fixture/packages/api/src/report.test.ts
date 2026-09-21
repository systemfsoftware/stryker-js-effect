import { describe, expect, test } from 'vitest'

import { cap, handle, statusFor } from './report.js'

const enabledConfig = { enabled: true, canaryPercent: 10 }

describe('handle', () => {
  test('routes a valid incident to the severity channel', () => {
    expect(handle({ severity: 'critical', note: 'disk full', config: enabledConfig })).toBe('pager:disk full')
  })

  test('defaults the note when absent', () => {
    expect(handle({ severity: 'info', config: enabledConfig })).toBe('log:none')
  })

  test('rejects a missing severity', () => {
    expect(handle({ config: enabledConfig })).toBe('rejected: missing severity')
  })

  test('rejects a disabled feature', () => {
    expect(handle({ severity: 'warning', config: { enabled: false, canaryPercent: 10 } })).toBe(
      'rejected: feature disabled',
    )
  })

  test('rejects when the config is absent', () => {
    expect(handle({ severity: 'warning' })).toBe('rejected: feature disabled')
  })
})

describe('cap', () => {
  test('passes amounts below the ceiling through rounding', () => {
    expect(cap(3.456, 5)).toBe(3.46)
  })

  test('clamps amounts above the ceiling', () => {
    expect(cap(6, 5)).toBe(5)
  })

  test('keeps exact-ceiling amounts unchanged', () => {
    expect(cap(5, 5)).toBe(5)
  })
})

describe('statusFor', () => {
  test('delegates to the services gate over the package boundary', () => {
    expect(statusFor(enabledConfig)).toBe('partial')
    expect(statusFor(undefined)).toBe('off')
  })
})
