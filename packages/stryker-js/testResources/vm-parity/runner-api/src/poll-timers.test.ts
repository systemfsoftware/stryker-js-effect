import { expect, test, vi } from 'vitest'

test('expect.poll waits until the value satisfies the matcher', async () => {
  let attempts = 0
  const eventually = (): number => {
    attempts += 1
    return attempts
  }
  await expect.poll(eventually, { interval: 10, timeout: 1000 }).toBeGreaterThan(2)
})

test('fake timers advance without real waiting', () => {
  vi.useFakeTimers()
  let fired = false
  setTimeout(() => {
    fired = true
  }, 1000)
  vi.advanceTimersByTime(1000)
  expect(fired).toBe(true)
  vi.useRealTimers()
})

test('vi.waitFor waits for the callback to stop throwing', async () => {
  let ready = false
  setTimeout(() => {
    ready = true
  }, 10)
  await vi.waitFor(() => {
    if (!ready) {
      throw new Error('not ready yet')
    }
  }, { timeout: 1000, interval: 10 })
})
