import { expect, test } from 'vitest'

import { isEven } from './thing.js'

test('isEven reports three as even', () => {
  // deliberately failing: the dry run must fail before any mutant runs
  expect(isEven(3)).toBe(true)
})
