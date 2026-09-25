import { expect, it } from 'vitest'

import { farewell } from '../src/top.js'

it('returns the farewell', () => {
  expect(farewell()).toBe('bye')
})
