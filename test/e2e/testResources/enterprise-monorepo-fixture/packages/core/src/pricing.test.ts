import { describe, expect, test } from 'vitest'

import { discount, roundCents, subtotal, total } from './pricing.js'

const input = {
  unitPrice: 19.99,
  quantity: 3,
  discountRate: 0.1,
  taxRate: 0.2,
}

describe('roundCents', () => {
  test('rounds half up to two decimal places', () => {
    expect(roundCents(10.126)).toBe(10.13)
  })

  test('leaves amounts below the half-cent boundary', () => {
    expect(roundCents(10.124)).toBe(10.12)
  })
})

describe('subtotal', () => {
  test('multiplies unit price by quantity', () => {
    expect(subtotal(input)).toBe(59.97)
  })

  test('is zero for zero quantity', () => {
    expect(subtotal({ ...input, quantity: 0 })).toBe(0)
  })
})

describe('discount', () => {
  test('applies the discount rate to the subtotal', () => {
    expect(discount(input)).toBeCloseTo(6, 6)
  })

  test('is zero without a discount', () => {
    expect(discount({ ...input, discountRate: 0 })).toBe(0)
  })
})

describe('total', () => {
  test('discounts the subtotal then applies tax', () => {
    expect(total(input)).toBe(64.76)
  })

  test('returns zero for non-finite intermediates', () => {
    expect(total({ ...input, unitPrice: Number.POSITIVE_INFINITY })).toBe(0)
  })

  test('returns zero for NaN intermediates', () => {
    expect(total({ ...input, unitPrice: Number.NaN })).toBe(0)
  })
})
