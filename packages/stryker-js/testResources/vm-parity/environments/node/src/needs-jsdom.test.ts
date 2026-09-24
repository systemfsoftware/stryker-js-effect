// @vitest-environment jsdom
import { expect, test } from 'vitest'

test('a jsdom docblock inside a node-default project gets a document', () => {
  expect(document).toBeDefined()
  expect(window.location.href).toBe('https://jsdom.example/page')
})
