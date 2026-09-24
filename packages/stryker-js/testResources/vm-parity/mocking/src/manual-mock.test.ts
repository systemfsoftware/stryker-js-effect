import { expect, test, vi } from 'vitest'

vi.mock('./manual-target')

import { title } from './manual-target'

test('uses the adjacent __mocks__ implementation', () => {
  expect(title()).toBe('manual title')
})
