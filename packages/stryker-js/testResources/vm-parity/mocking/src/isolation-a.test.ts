import { expect, test, vi } from 'vitest'

vi.mock('./isolation-target', () => ({ marker: () => 'mocked marker' }))

import { marker } from './isolation-target'

test('this file sees the mock', () => {
  expect(marker()).toBe('mocked marker')
})
