import { expect, test } from 'vitest'

import { describeKind } from './consumer.js'

test('describeKind prefixes the payload kind', () => {
  expect(describeKind()).toBe('kind:payload')
})
