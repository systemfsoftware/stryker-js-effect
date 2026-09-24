import { expect, test } from 'vitest'

import { manifest } from './summary'

test('inline object snapshot', () => {
  expect(manifest()).toMatchInlineSnapshot(`
    {
      "alpha": 1,
      "beta": 2,
    }
  `)
})

test('inline string snapshot', () => {
  expect('inline value').toMatchInlineSnapshot(`"inline value"`)
})

test('inline thrown message', () => {
  expect(() => {
    throw new Error('inline boom')
  }).toThrowErrorMatchingInlineSnapshot(`[Error: inline boom]`)
})
