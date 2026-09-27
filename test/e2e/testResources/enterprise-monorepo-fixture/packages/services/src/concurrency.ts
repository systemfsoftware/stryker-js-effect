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
  // @stryker-expect next-line CompileError(TS2355): BlockStatement
): Promise<BatchResult<T>> => {
  const succeeded = new Map<string, T>()
  const failed = new Map<string, string>()

  // @stryker-expect next-line KilledOrTimeout: ConditionalExpression="true"
  // @stryker-expect next-line Survived: ConditionalExpression="false", BlockStatement="{}"
  // @stryker-expect next-line KilledOrTimeout: EqualityOperator="tasks.length !== 0"
  if (tasks.length === 0) {
    // @stryker-expect next-line CompileError(TS2739): ObjectLiteral
    return { succeeded, failed }
  }

  // @stryker-expect next-line Survived: MethodExpression="Math.min(1, concurrency)"
  const limit = Math.max(1, concurrency)
  let index = 0

  const worker = async (): Promise<void> => {
    // @stryker-expect next-line CompileError(TS18046): ConditionalExpression
    // @stryker-expect next-line Survived: EqualityOperator="index <= tasks.length"
    // @stryker-expect next-line KilledOrTimeout: EqualityOperator="index >= tasks.length", BlockStatement="{}"
    while (index < tasks.length) {
      // @stryker-expect next-line CompileError(TS18048): OptionalChaining="signal.aborted"
      // @stryker-expect next-line CompileError(TS18046): ConditionalExpression="true"
      // @stryker-expect next-line Survived: ConditionalExpression="false"
      // @stryker-expect next-line NoCoverage: BlockStatement="{}"
      if (signal?.aborted) {
        break
      }
      const taskIndex = index
      index += 1
      const currentTask = tasks[taskIndex]
      // @stryker-expect next-line CompileError(TS2339): BooleanLiteral
      // @stryker-expect next-line CompileError(TS18046): ConditionalExpression="true"
      // @stryker-expect next-line Survived: ConditionalExpression="false"
      // @stryker-expect next-line NoCoverage: BlockStatement="{}"
      if (!currentTask) {
        break
      }

      try {
        // @stryker-expect next-line CompileError(TS18048): OptionalChaining="signal.aborted"
        // @stryker-expect next-line KilledOrTimeout: ConditionalExpression="true"
        // @stryker-expect next-line Survived: ConditionalExpression="false"
        // @stryker-expect next-line NoCoverage: BlockStatement="{}"
        if (signal?.aborted) {
          // @stryker-expect next-line NoCoverage: StringLiteral
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

  // @stryker-expect next-line CompileError(TS2322): ArrayDeclaration
  const workers: Promise<void>[] = []
  const workerCount = Math.min(limit, tasks.length)
  // @stryker-expect next-line KilledOrTimeout: EqualityOperator="i <= workerCount"
  // @stryker-expect next-line KilledOrTimeout: EqualityOperator="i >= workerCount", ConditionalExpression="false", BlockStatement, UpdateOperator="i--"
  for (let i = 0; i < workerCount; i++) {
    workers.push(worker())
  }

  await Promise.all(workers)
  // @stryker-expect next-line CompileError(TS2739): ObjectLiteral
  return { succeeded, failed }
}

export async function* streamAsyncGenerator<T>(
  items: ReadonlyArray<T>,
  advance: () => Promise<void>,
  signal?: AbortSignal,
): AsyncIterableIterator<T> {
  for (const item of items) {
    // @stryker-expect next-line CompileError(TS18048): OptionalChaining="signal.aborted"
    // @stryker-expect next-line KilledOrTimeout: ConditionalExpression="true"
    // @stryker-expect next-line Survived: ConditionalExpression="false"
    // @stryker-expect next-line Survived: BlockStatement="{}"
    if (signal?.aborted) {
      return
    }
    await advance()
    // @stryker-expect next-line CompileError(TS18048): OptionalChaining="signal.aborted"
    // @stryker-expect next-line KilledOrTimeout: ConditionalExpression="true"
    // @stryker-expect next-line Survived: ConditionalExpression="false"
    // @stryker-expect next-line NoCoverage: BlockStatement="{}"
    if (signal?.aborted) {
      return
    }
    yield item
  }
}

// @stryker-expect next-line CompileError(TS2355): BlockStatement
export const executeBatchUntilTarget = (count: number): number => {
  let iterations = 0
  while (iterations < count) {
    iterations += 1
  }
  return iterations
}

// @stryker-expect next-line CompileError(TS2355): BlockStatement
export const getTimestampedId = (prefix: string): string => {
  const now = Date.now()
  return `${prefix}:${now}`
}

// @stryker-expect file KilledOrTimeout: all
