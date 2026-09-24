import { expect, test } from 'vitest'

import { add, multiply } from '../calc'

test('the node project ran its own setup file', () => {
  expect(globalThis['projectMarker']).toBe('node-setup')
})

test('the node project computes arithmetic', () => {
  expect(add(2, 3)).toBe(5)
  expect(multiply(2, 3)).toBe(6)
})
