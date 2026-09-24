import { expect, test } from 'vitest'

import { sum } from '@/sum'

test('the alias resolves into src', () => {
  expect(sum(2, 3)).toBe(5)
})
