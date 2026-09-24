import { describe, expect, test } from 'vitest'

import { square } from './math'

describe('math', () => {
  describe.each([
    ['positive', 2],
    ['negative', -2],
  ])('%s input', (_label, input) => {
    test.each([1, 2])('snapshot for %i', (extra) => {
      expect({ input, output: square(input), extra }).toMatchSnapshot()
    })
  })
})
