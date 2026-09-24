import { describe, expect, test } from 'vitest'

import { double } from './counter'

describe.each([2, 3])('double %i', (input) => {
  test(`test.each doubles ${input}`, () => {
    expect(double(input)).toBe(input * 2)
  })
})

test.for([
  { input: 2, output: 4 },
  { input: 5, output: 10 },
])('test.for handles $input', ({ input, output }) => {
  expect(double(input)).toBe(output)
})
