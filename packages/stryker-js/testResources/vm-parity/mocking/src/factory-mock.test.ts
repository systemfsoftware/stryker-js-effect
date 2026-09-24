import { expect, test, vi } from 'vitest'

vi.mock('./format', () => ({
  uppercase: (value: string) => value,
  greet: vi.fn((name: string) => `mocked hello ${name}`),
}))

import { greet } from './format'

test('the factory supplies the implementation', () => {
  expect(greet('ada')).toBe('mocked hello ada')
})

test('the mocked export is a spy', () => {
  expect(vi.isMockFunction(greet)).toBe(true)
})
