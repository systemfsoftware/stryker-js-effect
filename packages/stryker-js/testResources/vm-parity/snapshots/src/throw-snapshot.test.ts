import { expect, test } from 'vitest'

const explode = (): never => {
  throw new Error('boom with a stable message')
}

test('matches the thrown message snapshot', () => {
  expect(() => explode()).toThrowErrorMatchingSnapshot()
})
