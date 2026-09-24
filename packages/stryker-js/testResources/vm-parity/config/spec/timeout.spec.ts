import { expect, test } from 'vitest'

test('the raised timeout budget covers a 50ms wait', async () => {
  const startedAt = Date.now()
  const { promise, resolve } = Promise.withResolvers<void>()
  setTimeout(resolve, 50)
  await promise
  expect(Date.now() - startedAt).toBeGreaterThan(0)
})
