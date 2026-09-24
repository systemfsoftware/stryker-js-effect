import { expect, test, vi } from 'vitest'

test('resetModules gives a fresh copy of module state', async () => {
  const first = await import('./reset-state')
  expect(first.bump()).toBe(1)
  expect(first.current()).toBe(1)

  vi.resetModules()

  const second = await import('./reset-state')
  expect(second.current()).toBe(0)
  expect(second.bump()).toBe(1)
})
