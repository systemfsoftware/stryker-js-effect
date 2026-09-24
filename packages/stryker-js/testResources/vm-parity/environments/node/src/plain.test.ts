import { expect, test } from 'vitest'

import { label } from './labels'

test('the node project has no document', () => {
  expect(globalThis.document).toBeUndefined()
  expect(label(['a', 'b'])).toBe('a-b')
})
