import { expect, test, vi } from 'vitest'
import type * as ActualFormat from './format'

import { greet } from './format'

vi.mock('./format', () => ({ uppercase: (value: string) => value, greet: () => 'mocked' }))

test('importActual reaches past the mock registry to the real module', async () => {
  const actual = await vi.importActual<ActualFormat>('./format')
  expect(actual.greet('ada')).toBe('Hello, ADA!')
})

test('the static import still sees the mock', () => {
  expect(greet('ada')).toBe('mocked')
})
