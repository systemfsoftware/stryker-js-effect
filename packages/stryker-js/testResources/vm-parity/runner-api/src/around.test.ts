import { aroundAll, aroundEach, expect, test } from 'vitest'

const events: string[] = []

aroundAll(async (runSuite) => {
  events.push('suite-start')
  await runSuite()
  events.push('suite-end')
})

aroundEach(async (runTest) => {
  events.push('around-before')
  await runTest()
  events.push('around-after')
})

test('aroundEach wraps the test body', () => {
  expect(events[0]).toBe('suite-start')
  expect(events.at(-1)).toBe('around-before')
})

test('aroundEach fired again for the second test', () => {
  expect(events.filter((event) => event === 'around-before')).toHaveLength(2)
})

test('the aroundAll hook closes the file after the last test', () => {
  expect(events.at(-1)).toBe('around-before')
})
