import { expect, test } from 'vitest'

import { flaky } from './flaky'

test('passes on the second attempt', { retry: 2 }, () => {
  expect(flaky()).toBe('recovered')
})

test('repeats run the body more than once', { repeats: 2 }, () => {
  expect(1 + 1).toBe(2)
})
