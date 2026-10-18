import { expect, test } from 'vitest'

import { other } from './other.js'
import { target } from './target.js'

test('target adds its two operands', () => {
  expect(target(2, 3)).toBe(5)
})

test('other triples its operand', () => {
  expect(other(2)).toBe(6)
})
