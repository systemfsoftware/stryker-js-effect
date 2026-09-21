import { describe, expect, test } from 'vitest'

import { countVowels, EventFilter, retryPlan } from './stats.js'

describe('retryPlan', () => {
  test('applies the documented defaults', () => {
    expect(retryPlan()).toEqual({ attempts: 3, backoffMs: 25 })
  })

  test('honors explicit options', () => {
    expect(retryPlan({ attempts: 5, backoffMs: 40 })).toEqual({ attempts: 5, backoffMs: 40 })
  })

  test('fills only the missing option', () => {
    expect(retryPlan({ attempts: 2 })).toEqual({ attempts: 2, backoffMs: 25 })
  })
})

describe('countVowels', () => {
  test('counts each vowel occurrence', () => {
    expect(countVowels('enterprise monorepo')).toBe(8)
  })

  test('returns zero without vowels', () => {
    expect(countVowels('rhythm')).toBe(0)
  })

  test('handles the empty string', () => {
    expect(countVowels('')).toBe(0)
  })
})

describe('EventFilter', () => {
  const registry = { audit: true, debug: false }

  test('emits registered keys and reports first sightings', () => {
    const filter = new EventFilter()
    expect(filter.shouldEmit('audit', registry)).toBe(true)
    expect(filter.emitted).toBe(1)
    expect(filter.skipped).toBe(0)
    expect(filter.dropped).toBe(0)
  })

  test('does not repeat consecutive keys', () => {
    const filter = new EventFilter()
    expect(filter.shouldEmit('audit', registry)).toBe(true)
    expect(filter.shouldEmit('audit', registry)).toBe(false)
    expect(filter.emitted).toBe(2)
  })

  test('emits again once the key differs', () => {
    const filter = new EventFilter()
    expect(filter.shouldEmit('audit', registry)).toBe(true)
    expect(filter.shouldEmit('trace', { ...registry, trace: true })).toBe(true)
  })

  test('drops explicitly disabled keys', () => {
    const filter = new EventFilter()
    expect(filter.shouldEmit('debug', registry)).toBe(false)
    expect(filter.skipped).toBe(1)
    expect(filter.dropped).toBe(1)
    expect(filter.emitted).toBe(0)
  })

  test('skips unknown keys without dropping them', () => {
    const filter = new EventFilter()
    expect(filter.shouldEmit('verbose', registry)).toBe(false)
    expect(filter.skipped).toBe(1)
    expect(filter.dropped).toBe(0)
  })
})
