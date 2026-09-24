import { expect, test } from 'vitest'

test('define injects compile-time constants', () => {
  expect(__APP_VERSION__).toBe('1.2.3')
  expect(import.meta.env.VITE_FEATURE).toBe('enabled')
})
