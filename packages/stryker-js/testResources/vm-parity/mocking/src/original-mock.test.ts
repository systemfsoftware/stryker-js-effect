import { expect, test, vi } from 'vitest'
import type * as FormatModule from './format'

vi.mock('./format', async (importOriginal) => {
  const original = await importOriginal<FormatModule>()
  return { ...original, uppercase: vi.fn(original.uppercase) }
})

import { greet, uppercase } from './format'

test('keeps the original exports while replacing one with a spy', () => {
  expect(greet('ada')).toBe('Hello, ADA!')
  expect(vi.isMockFunction(uppercase)).toBe(true)
})
