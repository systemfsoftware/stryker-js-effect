import { expect, test } from 'vitest'

import { firstOr } from './first.js'

test('firstOr returns the first value', () => {
  expect(firstOr(['alpha'])).toBe('alpha')
})

test('firstOr falls back to none when empty', () => {
  expect(firstOr([])).toBe('none')
})
