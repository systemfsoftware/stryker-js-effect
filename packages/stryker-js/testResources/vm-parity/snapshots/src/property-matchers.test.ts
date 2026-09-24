import { expect, test } from 'vitest'

test('property matchers pin the shape and match the rest', () => {
  expect({ id: 7, name: 'gear' }).toMatchSnapshot({ id: expect.any(Number), name: 'gear' })
})

test('property matchers fail when the pinned part drifts', () => {
  expect({ id: 8, name: 'bolt' }).toMatchSnapshot({ id: expect.any(Number), name: 'bolt' })
})
