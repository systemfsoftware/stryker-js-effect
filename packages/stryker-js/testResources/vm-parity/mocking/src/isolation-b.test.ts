import { expect, test } from 'vitest'

import { marker } from './isolation-target'

test('a sibling file that never mocks sees the real module', () => {
  expect(marker()).toBe('real marker')
})
