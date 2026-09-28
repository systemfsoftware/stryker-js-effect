import { describe, expect, test } from 'vitest'

import { applyVolumeRebate, discount, refund, roundCents, subtotal, total } from './pricing.js'

const sampleOrder = {
  unitPrice: 19.99,
  quantity: 3,
  discountRate: 0.1,
  taxRate: 0.2,
}

describe.concurrent('Feature: Financial Pricing, Discounting, and Taxation', () => {
  describe.concurrent('Rule: Currency amounts must round half up to two decimal places', () => {
    test.each([
      { amount: 10.126, expected: 10.13, description: 'fractional cent at or above half cent boundary' },
      { amount: 10.124, expected: 10.12, description: 'fractional cent below half cent boundary' },
    ])('Given $description, When rounded, Then roundCents returns $expected', ({ amount, expected }) => {
      expect(roundCents(amount)).toBe(expected)
    })
  })

  describe.concurrent('Rule: Subtotal is the product of unit price and quantity', () => {
    test.each([
      { input: sampleOrder, expected: 59.97, description: 'standard unit price and quantity' },
      { input: { ...sampleOrder, quantity: 0 }, expected: 0, description: 'zero quantity' },
    ])('Given $description, When calculating subtotal, Then it evaluates to $expected', ({ input, expected }) => {
      expect(subtotal(input)).toBe(expected)
    })
  })

  describe.concurrent('Rule: Discounts are computed from the subtotal by discount rate', () => {
    test.each([
      { input: sampleOrder, expected: 6, description: '10% discount on order' },
      { input: { ...sampleOrder, discountRate: 0 }, expected: 0, description: 'zero discount rate' },
    ])('Given $description, When calculating discount, Then it evaluates to $expected', ({ input, expected }) => {
      expect(discount(input)).toBeCloseTo(expected, 6)
    })
  })

  describe.concurrent('Rule: Total incorporates discounts and tax with safeguards for non-finite values', () => {
    test.each([
      { input: sampleOrder, expected: 64.76, description: 'standard order inputs' },
      {
        input: { ...sampleOrder, unitPrice: Number.POSITIVE_INFINITY },
        expected: 0,
        description: 'infinite unit price',
      },
      { input: { ...sampleOrder, unitPrice: Number.NaN }, expected: 0, description: 'NaN unit price' },
    ])('Given $description, When total is computed, Then it evaluates to $expected', ({ input, expected }) => {
      expect(total(input)).toBe(expected)
    })
  })

  describe.concurrent('Rule: Volume rebates scale with quantity tiers', () => {
    test.each([
      { input: { quantity: 1500, baseAmount: 100 }, expected: 75, description: 'tier 1: >=1000 items (25% rebate)' },
      { input: { quantity: 1000, baseAmount: 100 }, expected: 75, description: 'tier 1 boundary: exactly 1000 items' },
      { input: { quantity: 600, baseAmount: 100 }, expected: 85, description: 'tier 2: >=500 items (15% rebate)' },
      { input: { quantity: 500, baseAmount: 100 }, expected: 85, description: 'tier 2 boundary: exactly 500 items' },
      { input: { quantity: 150, baseAmount: 100 }, expected: 95, description: 'tier 3: >=100 items (5% rebate)' },
      { input: { quantity: 100, baseAmount: 100 }, expected: 95, description: 'tier 3 boundary: exactly 100 items' },
      { input: { quantity: 99, baseAmount: 100 }, expected: 100, description: 'below every tier: 99 items' },
      { input: { quantity: 20, baseAmount: 100 }, expected: 100, description: 'tier 0: <100 items (no rebate)' },
      { input: { quantity: 0, baseAmount: 100 }, expected: 100, description: 'zero quantity returns base amount' },
    ])('Given $description, When applying rebate, Then final amount is $expected', ({ input, expected }) => {
      expect(applyVolumeRebate(input)).toBe(expected)
    })

    test.each([
      {
        input: { quantity: 51, baseAmount: 100, isPrivilegedAccount: true },
        expected: 95,
        description: 'privileged account above the quantity floor',
      },
      {
        input: { quantity: 50, baseAmount: 100, isPrivilegedAccount: true },
        expected: 100,
        description: 'privileged account exactly at the quantity floor',
      },
      {
        input: { quantity: 1200, baseAmount: 100, isPrivilegedAccount: true },
        expected: 70,
        description: 'privileged account combining a tier rebate with the privileged bonus',
      },
    ])('Given $description, When applying rebate, Then final amount is $expected', ({ input, expected }) => {
      expect(applyVolumeRebate(input)).toBe(expected)
    })
  })

  describe.concurrent('Rule: Refunds carry the negated rounded amount', () => {
    test.each([
      { amount: 12.5, expected: -12.5, description: 'exact amount' },
      { amount: 10.126, expected: -10.13, description: 'amount rounded before it is negated' },
    ])('Given $description, When refunded, Then refund returns $expected', ({ amount, expected }) => {
      expect(refund(amount)).toBe(expected)
    })
  })
})
