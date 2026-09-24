import { expect, test, vi } from 'vitest'

const hoisted = vi.hoisted(() => ({ label: vi.fn(() => 'hoisted label') }))

vi.mock('./hoisted-target', () => ({ label: hoisted.label }))

import { label } from './hoisted-target'

test('the factory reads the hoisted value', () => {
  expect(label()).toBe('hoisted label')
  expect(hoisted.label).toHaveBeenCalledTimes(1)
})
