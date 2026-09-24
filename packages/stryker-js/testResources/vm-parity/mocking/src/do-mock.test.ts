import { expect, test, vi } from 'vitest'

test('doMock applies to a dynamic import', async () => {
  vi.doMock('./do-mock-target', () => ({ tag: () => 'do-mocked tag' }))
  const mockedModule = await import('./do-mock-target')
  expect(mockedModule.tag()).toBe('do-mocked tag')
  vi.doUnmock('./do-mock-target')
})

test('doUnmock lets the next dynamic import see the real module', async () => {
  const realModule = await import('./do-mock-target')
  expect(realModule.tag()).toBe('real tag')
})
