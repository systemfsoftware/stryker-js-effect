import { expect, test, vi } from 'vitest'

vi.mock('./spy-target', { spy: true })

import { multiply } from './spy-target'

test('spies keep the real implementation and record calls', () => {
  expect(multiply(3, 4)).toBe(12)
  expect(multiply).toHaveBeenCalledWith(3, 4)
})
