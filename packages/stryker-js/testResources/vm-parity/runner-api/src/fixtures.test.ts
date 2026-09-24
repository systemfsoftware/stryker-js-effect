import { expect, test } from 'vitest'

const teardownLog: string[] = []

const base = test.extend<{ value: number; log: string[] }>({
  value: async ({}, use) => {
    await use(21)
  },
  log: async ({}, use) => {
    const entries: string[] = ['fixture-started']
    await use(entries)
    teardownLog.push(...entries)
  },
})

const composed = base.extend<{ doubled: number }>({
  doubled: async ({ value }, use) => {
    await use(value * 2)
  },
})

const suite = composed.extend<{ autoLog: string[] }>({
  autoLog: [
    async ({}, use) => {
      const entries: string[] = ['auto-started']
      await use(entries)
      teardownLog.push(...entries)
    },
    { auto: true },
  ],
})

suite('dependent fixtures compose and the auto fixture runs first', ({ value, doubled, log, autoLog }) => {
  expect(value).toBe(21)
  expect(doubled).toBe(42)
  log.push('test-ran')
  autoLog.push('test-ran-auto')
  expect(log).toEqual(['fixture-started', 'test-ran'])
  expect(autoLog).toEqual(['auto-started', 'test-ran-auto'])
})

suite('fixture teardown ran after the previous test finished', () => {
  expect(teardownLog).toHaveLength(4)
  expect(teardownLog).toContain('fixture-started')
  expect(teardownLog).toContain('test-ran')
  expect(teardownLog).toContain('auto-started')
  expect(teardownLog).toContain('test-ran-auto')
})
