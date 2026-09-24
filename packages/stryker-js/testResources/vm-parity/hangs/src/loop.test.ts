import { expect, test } from 'vitest'

import { accumulate } from './loop'

test('accumulates every step below the limit', () => {
  expect(accumulate(3)).toBe(3)
})

test('a limit of zero accumulates nothing', () => {
  expect(accumulate(0)).toBe(0)
})
