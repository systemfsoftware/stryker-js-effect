import { expect, test } from 'vitest'

import { isZero, makeMoney } from './core.js'
import { chargeTax, formatInvoice } from './service.js'

test('money creation and zero check', () => {
  const zero = makeMoney(0, 'USD')
  expect(isZero(zero)).toBe(true)
})

test('chargeTax calculates total with rate', () => {
  const net = makeMoney(100, 'USD')
  const total = chargeTax(net, 0.2)
  expect(total.amount).toBe(120)
  expect(total.currency).toBe('USD')
})

test('formatInvoice formats invoice with currency symbol', () => {
  const usd = makeMoney(42, 'USD')
  expect(formatInvoice(usd)).toBe('$42.00')
})
