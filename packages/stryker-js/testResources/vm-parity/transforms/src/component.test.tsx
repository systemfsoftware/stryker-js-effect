import { expect, test } from 'vitest'

import { greeting, list, pair } from './component'

test('the classic pragma compiles elements through the local h', () => {
  const node = greeting()
  expect(node.tag).toBe('p')
  expect(node.children).toHaveLength(1)
  expect(node.children[0]?.tag).toBe('#text')
})

test('lists map to a matching item count', () => {
  const node = list(['a', 'b', 'c'])
  expect(node.tag).toBe('ul')
  expect(node.children.map((child) => child.tag)).toEqual(['li', 'li', 'li'])
})

test('fragments group siblings without a wrapper tag', () => {
  const node = pair()
  expect(node.tag).toBe('fragment')
  expect(node.children).toHaveLength(2)
})
