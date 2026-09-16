import { expect, test } from 'vitest'

import { add, double, isPositive } from './calc.js'

test('add adds its two operands', () => {
  expect(add(2, 3)).toBe(5)
})

test('isPositive separates a positive number from zero', () => {
  expect(isPositive(0)).toBe(false)
  expect(isPositive(1)).toBe(true)
})

test('double is called but never pinned — its mutants are this fixture’s survivors', () => {
  expect(() => double(3)).not.toThrow()
})
