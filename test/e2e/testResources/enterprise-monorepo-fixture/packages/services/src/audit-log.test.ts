import { describe, expect, test } from 'vitest'

import { AUDIT_LOG } from './audit-log.js'

describe('AUDIT_LOG', () => {
  test('records the boot sequence', () => {
    expect([...AUDIT_LOG]).toEqual(['boot', 'ready'])
  })
})
