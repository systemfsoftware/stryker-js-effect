import { expect, test } from 'vitest'

import { add } from '../calc'

test('the dom project ran its own setup file under happy-dom', () => {
  expect(globalThis['projectMarker']).toBe('dom-setup')
  expect(document.createElement('section').tagName).toBe('SECTION')
})

test('the dom project shares the source under test', () => {
  expect(add(1, 1)).toBe(2)
})
