import { expect, test, vi } from 'vitest'
import type * as AutomockTarget from './automock-target'

test('importMock returns the automocked module', async () => {
  const mocked = await vi.importMock<AutomockTarget>('./automock-target')
  expect(vi.isMockFunction(mocked.add)).toBe(true)
  expect(mocked.add(1, 2)).toBeUndefined()
})
