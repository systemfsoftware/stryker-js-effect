import { expect, test } from 'vitest'

import { double } from './counter'

const condition = true

test.skipIf(condition)('skipped because the condition holds', () => {
  throw new Error('this test should be skipped')
})

test.runIf(!condition)('never runs because the condition fails', () => {
  throw new Error('this test should not run')
})

test('skipIf keeps ordinary tests running', () => {
  expect(double(2)).toBe(4)
})

test.fails('a failing assertion marks the test as expected-to-fail', () => {
  expect(double(2)).toBe(5)
})

test.fails('expect.soft collects both failures without stopping', () => {
  expect.soft(double(2)).toBe(5)
  expect.soft(double(3)).toBe(7)
})
