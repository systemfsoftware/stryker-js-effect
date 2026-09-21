import { describe, expect, test } from 'vitest'

import { HANDLERS, isKnownSeverity, route } from './dispatch.js'

describe('HANDLERS', () => {
  test('covers every severity in the core contract', () => {
    expect(Object.keys(HANDLERS).sort()).toEqual(['critical', 'info', 'warning'])
  })
})

describe('route', () => {
  test('maps each severity to its channel', () => {
    expect(route('info').channel).toBe('log')
    expect(route('warning').channel).toBe('email')
    expect(route('critical').channel).toBe('pager')
  })
})

describe('isKnownSeverity', () => {
  test('accepts contract severities', () => {
    expect(isKnownSeverity('info')).toBe(true)
    expect(isKnownSeverity('critical')).toBe(true)
  })

  test('rejects unknown candidates', () => {
    expect(isKnownSeverity('verbose')).toBe(false)
    expect(isKnownSeverity('')).toBe(false)
  })
})
