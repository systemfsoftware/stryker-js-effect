import { expect, test } from 'vitest'

import { area, perimeter } from './geometry'

test('the happy-dom project exposes document and window', () => {
  const element = document.createElement('div')
  element.textContent = 'hello dom'
  expect(element.textContent).toBe('hello dom')
  expect(globalThis.window).toBeDefined()
})

test('the happy-dom environment honors its url option', () => {
  expect(window.location.origin).toBe('https://happy-dom.example')
})

test('pure geometry still computes under the dom environment', () => {
  expect(area(2, 3)).toBe(6)
  expect(perimeter(2, 3)).toBe(10)
})
