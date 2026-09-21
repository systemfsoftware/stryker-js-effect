import { expect, test } from 'vitest'

import { API_NAME } from './index.js'

test('api barrel exposes the package name', () => {
  expect(API_NAME).toBe('@enterprise/api')
})
