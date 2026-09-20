import { expect, test } from 'vitest'

import { calculateTotal, initialStatus } from './order.js'

test('order initial status is pending', () => {
  expect(initialStatus()).toBe('pending')
})

test('calculateTotal calculates total with tax', () => {
  expect(calculateTotal(100, 0.1)).toBe(110)
})
