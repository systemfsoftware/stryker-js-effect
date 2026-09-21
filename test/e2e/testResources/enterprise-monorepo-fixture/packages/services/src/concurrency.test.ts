import { describe, expect, test } from 'vitest'

import { processConcurrentPool, streamAsyncGenerator, type Task } from './concurrency.js'

describe.concurrent('Feature: Concurrency Control and Async Backpressure', () => {
  describe.concurrent('Rule: Pool processes tasks concurrently up to concurrency limit', () => {
    test('Given tasks, When processed with concurrency limit, Then all succeed', async () => {
      let active = 0
      let maxActive = 0

      const tasks: Task<number>[] = Array.from({ length: 6 }, (_, i) => ({
        id: `t-${i}`,
        execute: async () => {
          active += 1
          if (active > maxActive) {
            maxActive = active
          }
          await Promise.resolve()
          active -= 1
          return i * 2
        },
      }))

      const result = await processConcurrentPool(tasks, 2)
      expect(maxActive).toBeLessThanOrEqual(2)
      expect(result.succeeded.size).toBe(6)
      expect(result.failed.size).toBe(0)
      expect(result.succeeded.get('t-0')).toBe(0)
      expect(result.succeeded.get('t-5')).toBe(10)
    })

    test('Given empty task list, When processed, Then returns empty maps', async () => {
      const result = await processConcurrentPool([], 4)
      expect(result.succeeded.size).toBe(0)
      expect(result.failed.size).toBe(0)
    })

    test('Given failing tasks, When processed, Then captures failure messages without throwing', async () => {
      const tasks: Task<string>[] = [
        { id: 'ok', execute: async () => 'success' },
        {
          id: 'fail',
          execute: async () => {
            throw new Error('boom')
          },
        },
      ]
      const result = await processConcurrentPool(tasks, 2)
      expect(result.succeeded.get('ok')).toBe('success')
      expect(result.failed.get('fail')).toBe('boom')
    })
  })

  describe.concurrent('Rule: Streaming async generator yields values with cancellation support', () => {
    test('Given items, When streamed without cancellation, Then yields all items', async () => {
      const items = [1, 2, 3]
      const collected: number[] = []
      for await (const val of streamAsyncGenerator(items, () => Promise.resolve())) {
        collected.push(val)
      }
      expect(collected).toEqual([1, 2, 3])
    })

    test('Given an aborted signal before start, When streamed, Then terminates early', async () => {
      const ac = new AbortController()
      ac.abort()
      const collected: number[] = []
      for await (const val of streamAsyncGenerator([1, 2, 3], () => Promise.resolve(), ac.signal)) {
        collected.push(val)
      }
      expect(collected).toEqual([])
    })
  })
})
