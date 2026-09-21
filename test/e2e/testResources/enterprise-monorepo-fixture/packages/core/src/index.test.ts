import { expect, test } from 'vitest'

import { CORE_NAME } from './index.js'

test('core barrel exposes the package name', () => {
  expect(CORE_NAME).toBe('@enterprise/core')
})
