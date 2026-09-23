import { expect, it } from 'vitest'

import { accrue } from './nontermination.js'

it('finishes a finite count', () => {
  expect(accrue(8)).toBe(8)
})
