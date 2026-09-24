import { expect, test, vi } from 'vitest'

vi.mock('node:path', () => ({ join: vi.fn((...parts: string[]) => parts.join('|')) }))

import { join } from 'node:path'

import { joined } from './builtin-user'

test('mocks a node builtin with a factory', () => {
  expect(joined('a', 'b')).toBe('a|b')
  expect(join).toHaveBeenCalledWith('a', 'b')
})
