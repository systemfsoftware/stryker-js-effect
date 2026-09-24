import { expect, test } from 'vitest'

import { manifest, widget } from './summary'

test('matches an object snapshot', () => {
  expect(widget('gear', 4)).toMatchSnapshot()
})

test('matches a string snapshot', () => {
  expect('a stable string').toMatchSnapshot()
})

test('matches several snapshots in one test with hints', () => {
  expect(manifest()).toMatchSnapshot('the manifest')
  expect({ ordered: [1, 2, 3] }).toMatchSnapshot('the ordered list')
})
