// @vitest-environment jsdom
import { expect, test } from 'vitest'

test('a docblock overrides the configured happy-dom environment', () => {
  expect(document).toBeDefined()
  expect(globalThis.window).toBeDefined()
})
