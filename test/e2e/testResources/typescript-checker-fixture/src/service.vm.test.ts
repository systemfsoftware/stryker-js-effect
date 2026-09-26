import { expect, test } from 'vitest'

import { isZero, makeMoney } from './core.js'
import { chargeTax, formatInvoice } from './service.js'

test('a zero amount is zero', () => {
  expect(isZero(makeMoney(0, 'USD'))).toBe(true)
})

test('chargeTax adds the rate to the amount and keeps the currency', () => {
  const total = chargeTax(makeMoney(100, 'USD'), 0.2)
  expect(total.amount).toBe(120)
  expect(total.currency).toBe('USD')
})

test('formatInvoice renders dollars with two decimals', () => {
  expect(formatInvoice(makeMoney(42, 'USD'))).toBe('$42.00')
})
