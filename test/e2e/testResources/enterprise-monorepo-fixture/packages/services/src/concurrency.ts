export interface Task<T> {
  readonly id: string
  readonly execute: (signal?: AbortSignal) => Promise<T>
}

export interface BatchResult<T> {
  readonly succeeded: ReadonlyMap<string, T>
  readonly failed: ReadonlyMap<string, string>
}

export const processConcurrentPool = async <T>(
  tasks: ReadonlyArray<Task<T>>,
  concurrency: number,
  signal?: AbortSignal,
): Promise<BatchResult<T>> => {
  const succeeded = new Map<string, T>()
  const failed = new Map<string, string>()

  if (tasks.length === 0) {
    return { succeeded, failed }
  }

  const limit = Math.max(1, concurrency)
  let index = 0

  const worker = async (): Promise<void> => {
    while (index < tasks.length) {
      if (signal?.aborted) {
        break
      }
      const taskIndex = index
      index += 1
      const currentTask = tasks[taskIndex]
      if (!currentTask) {
        break
      }

      try {
        if (signal?.aborted) {
          failed.set(currentTask.id, 'aborted')
          break
        }
        const result = await currentTask.execute(signal)
        succeeded.set(currentTask.id, result)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        failed.set(currentTask.id, message)
      }
    }
  }

  const workers: Promise<void>[] = []
  const workerCount = Math.min(limit, tasks.length)
  for (let i = 0; i < workerCount; i++) {
    workers.push(worker())
  }

  await Promise.all(workers)
  return { succeeded, failed }
}

export async function* streamAsyncGenerator<T>(
  items: ReadonlyArray<T>,
  advance: () => Promise<void>,
  signal?: AbortSignal,
): AsyncIterableIterator<T> {
  for (const item of items) {
    if (signal?.aborted) {
      return
    }
    await advance()
    if (signal?.aborted) {
      return
    }
    yield item
  }
}
export const executeBatchUntilTarget = (count: number): number => {
  let iterations = 0
  while (iterations < count) {
    iterations += 1
  }
  return iterations
}

export const getTimestampedId = (prefix: string): string => {
  const now = Date.now()
  return `${prefix}:${now}`
}
