import { expect, test } from 'vitest'

import { SERVICES_NAME } from './index.js'

test('services barrel exposes the package name', () => {
  expect(SERVICES_NAME).toBe('@enterprise/services')
})
