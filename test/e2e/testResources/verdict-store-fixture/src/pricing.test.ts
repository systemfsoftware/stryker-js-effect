import { expect, test } from 'vitest'

import { clamp, discounted, isBulk, isFree, label, shippingFor, subtotal, withTax } from './pricing.js'

const WALL_CLOCK_EACH_TEST_HOLDS_A_KILLABLE_RUN_OPEN_MILLIS = 40

const holdTheRunOpen = (): Promise<void> => {
  const { promise, resolve } = Promise.withResolvers<void>()
  setTimeout(resolve, WALL_CLOCK_EACH_TEST_HOLDS_A_KILLABLE_RUN_OPEN_MILLIS)
  return promise
}

test('subtotal adds every price', async () => {
  await holdTheRunOpen()
  expect(subtotal([1, 2, 3])).toBe(6)
})

test('discounted takes the percentage off', async () => {
  await holdTheRunOpen()
  expect(discounted(200, 25)).toBe(150)
})

test('withTax adds the rate', async () => {
  await holdTheRunOpen()
  expect(withTax(100, 0.2)).toBe(120)
})

test('isFree separates zero from a price', async () => {
  await holdTheRunOpen()
  expect(isFree(0)).toBe(true)
  expect(isFree(1)).toBe(false)
})

test('isBulk starts at ten', async () => {
  await holdTheRunOpen()
  expect(isBulk(10)).toBe(true)
  expect(isBulk(9)).toBe(false)
})

test('shippingFor charges by weight band', async () => {
  await holdTheRunOpen()
  expect(shippingFor(30)).toBe(15)
  expect(shippingFor(10)).toBe(8)
  expect(shippingFor(1)).toBe(3)
})

test('label is called but its threshold is never pinned', async () => {
  await holdTheRunOpen()
  expect(typeof label(50)).toBe('string')
})

test('clamp keeps a value inside its bounds', async () => {
  await holdTheRunOpen()
  expect(clamp(5, 0, 3)).toBe(3)
  expect(clamp(-1, 0, 3)).toBe(0)
})
