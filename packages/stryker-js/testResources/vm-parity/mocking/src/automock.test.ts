import { expect, test, vi } from 'vitest'

vi.mock('./automock-target')

import { add, Counter, helpers } from './automock-target'

test('automocked functions return undefined and record calls', () => {
  expect(add(1, 2)).toBeUndefined()
  expect(vi.isMockFunction(add)).toBe(true)
})

test('automocked nested objects keep their shape with mocked members', () => {
  expect(helpers.shout('hey')).toBeUndefined()
  expect(vi.isMockFunction(helpers.shout)).toBe(true)
})

test('automocked classes are constructible spies', () => {
  const counter = new Counter()
  const result = counter.increment()
  expect(result).toBeUndefined()
  expect(counter.increment).toHaveBeenCalledTimes(1)
})

test('automocks are configurable with mockReturnValue', () => {
  vi.mocked(add).mockReturnValue(5)
  expect(add(1, 2)).toBe(5)
})
