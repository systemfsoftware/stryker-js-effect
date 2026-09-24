import { expect, onTestFailed, onTestFinished, test } from 'vitest'

import { double } from './counter'

const finishedLog: string[] = []

interface EvenMatchers {
  toBeEven: () => void
}

expect.extend({
  toBeEven(received: unknown) {
    const even = typeof received === 'number' && received % 2 === 0
    return {
      pass: even,
      message: () => `expected ${String(received)} to be even`,
    }
  },
})

test('a custom matcher joins expect', () => {
  expect(double(2)).toBeEven()
})

test('expect.assertions pins the assertion count', () => {
  expect.assertions(2)
  expect(double(2)).toBe(4)
  expect(double(3)).toBe(6)
})

test('expect.hasAssertions requires at least one assertion', () => {
  expect.hasAssertions()
  expect(double(4)).toBe(8)
})

test('onTestFinished runs after the test passes', () => {
  onTestFinished(() => {
    finishedLog.push('finished')
  })
  onTestFailed(() => {
    finishedLog.push('must-not-run')
  })
  expect(double(6)).toBe(12)
})

test('the finished hook ran and the failed hook did not', () => {
  expect(finishedLog).toEqual(['finished'])
})
