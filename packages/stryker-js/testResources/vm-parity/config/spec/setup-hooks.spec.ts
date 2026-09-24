import { expect, test } from 'vitest'

test('the setup file assigned a global and ran its beforeEach', () => {
  expect(globalThis['setupMarker']).toBe('setup ran')
  expect(typeof globalThis['setupHookRuns']).toBe('number')
})

test('the setup beforeEach runs before every test', () => {
  expect(globalThis['setupHookRuns']).toBeGreaterThan(1)
})
