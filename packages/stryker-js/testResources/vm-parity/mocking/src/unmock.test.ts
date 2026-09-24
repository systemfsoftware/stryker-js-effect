import { expect, test, vi } from 'vitest'

vi.mock('./unmock-target', () => ({ flag: () => false }))
vi.unmock('./unmock-target')

import { flag } from './unmock-target'

test('unmock restores the real module for this file', () => {
  expect(flag()).toBe(true)
})
