import { describe, expect, test } from 'vitest'

import { double } from './counter'

describe.concurrent('concurrent suite', () => {
  test.concurrent('double 2 concurrently', async () => {
    await Promise.resolve()
    expect(double(2)).toBe(4)
  })

  test.concurrent('double 5 concurrently', async () => {
    await Promise.resolve()
    expect(double(5)).toBe(10)
  })
})

test.concurrent('a standalone concurrent test', async () => {
  await Promise.resolve()
  expect(double(7)).toBe(14)
})
