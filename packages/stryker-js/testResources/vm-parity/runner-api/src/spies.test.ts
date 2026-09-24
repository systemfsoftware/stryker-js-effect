import { env } from 'node:process'

import { expect, test, vi } from 'vitest'

const service = {
  fetchName: (): string => 'real name',
}

test('spyOn wraps an object method and can stub it', () => {
  const spy = vi.spyOn(service, 'fetchName').mockReturnValue('spied name')
  expect(service.fetchName()).toBe('spied name')
  expect(spy).toHaveBeenCalledTimes(1)
})

test('restoreMocks config restored the spy after the previous test', () => {
  expect(service.fetchName()).toBe('real name')
})

test('vi.fn creates a callable mock with call history', () => {
  const fn = vi.fn((value: number) => value * 2)
  fn(3)
  expect(fn).toHaveBeenCalledWith(3)
  expect(fn.mock.results[0]?.value).toBe(6)
})

test('stubGlobal is undone by unstubAllGlobals', () => {
  const originalFetch = globalThis.fetch
  vi.stubGlobal('fetch', vi.fn(async () => 'stubbed'))
  expect(typeof globalThis.fetch).toBe('function')
  vi.unstubAllGlobals()
  expect(globalThis.fetch).toBe(originalFetch)
})

test('stubEnv is undone by unstubAllEnvs', () => {
  vi.stubEnv('VM_PARITY_TOKEN', 'token-1')
  expect(env.VM_PARITY_TOKEN).toBe('token-1')
  vi.unstubAllEnvs()
  expect(env.VM_PARITY_TOKEN).toBeUndefined()
})
