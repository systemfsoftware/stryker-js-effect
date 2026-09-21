import { describe, expect, test } from 'vitest'

import { sleep } from './clock.js'

describe('sleep', () => {
  test('resolves without a value after the delay', async () => {
    await expect(sleep(1)).resolves.toBeUndefined()
  })
})
