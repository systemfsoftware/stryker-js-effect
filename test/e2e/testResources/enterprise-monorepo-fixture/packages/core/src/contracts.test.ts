import { describe, expect, test } from 'vitest'

import { SEVERITIES } from './contracts.js'

describe('SEVERITIES', () => {
  test('keys and values agree so Record consumers stay exhaustive', () => {
    expect(Object.keys(SEVERITIES)).toEqual(['info', 'warning', 'critical'])
    expect(SEVERITIES.info).toBe('info')
    expect(SEVERITIES.warning).toBe('warning')
    expect(SEVERITIES.critical).toBe('critical')
  })
})
