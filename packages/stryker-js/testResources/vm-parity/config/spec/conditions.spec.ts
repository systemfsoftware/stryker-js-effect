import { expect, test } from 'vitest'

import { flavor } from '#impl'

test('the custom resolution condition wins', () => {
  expect(flavor()).toBe('custom flavor')
})
