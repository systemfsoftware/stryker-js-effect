import { expect, test } from 'vitest'

import { isZero, makeMoney } from './core.js'
import { chargeTax, formatInvoice } from './service.js'

test('a zero amount is zero', () => {
  expect(isZero(makeMoney(0, 'USD'))).toBe(true)
})

test('chargeTax adds the rate to the net amount', () => {
  expect(chargeTax(makeMoney(100, 'USD'), 0.2)).toEqual(makeMoney(120, 'USD'))
})

test('formatInvoice prints dollars with two decimals', () => {
  expect(formatInvoice(makeMoney(42, 'USD'))).toBe('$42.00')
})
