import { currentSnapshotTest, type SnapshotTask, snapshotTaskOf } from './snapshot-test.js'

interface ExpectWithTest {
  readonly withTest: (test: SnapshotTask) => object
}

const isExpectWithTest = (value: object): value is ExpectWithTest =>
  typeof Reflect.get(value, 'withTest') === 'function'

const flagCurrentTest = (assertion: object): object => {
  const test = currentSnapshotTest()
  return test === undefined
    ? assertion
    : isExpectWithTest(assertion)
    ? assertion.withTest(snapshotTaskOf(test))
    : assertion
}

interface ExpectCall {
  (value: object, message?: string): object
}

const isExpectCall = (value: object): value is ExpectCall => typeof value === 'function'

/**
 * Vitest's own `expect` factory (`createExpect(test)`): a fresh `expect` whose
 * every assertion is tagged with the test it was created for. The vm runner
 * needs it because `expect.soft`, `expect.poll`, and `expect(...).resolves`
 * resolve their test from that tag, and the global `expect` has none.
 */
export type CreateExpect = (task: object) => object

interface RunnerWorkerState {
  readonly current?: object | null | undefined
}

const currentRunnerTask = (): object | undefined => {
  const workerState = Reflect.get(globalThis, '__vitest_worker__') as RunnerWorkerState | undefined
  const current = workerState?.current
  return typeof current === 'object' && current !== null ? current : undefined
}

const dispatcherExpect = (real: object, createExpect: CreateExpect): object => {
  const perTask = new WeakMap<object, object>()
  const expectFor = (): object => {
    const task = currentRunnerTask()
    if (task === undefined) {
      return real
    }
    const cached = perTask.get(task)
    if (cached !== undefined) {
      return cached
    }
    const built = createExpect(task)
    perTask.set(task, built)
    return built
  }
  return new Proxy(real, {
    apply(_target, thisArg, args) {
      return Reflect.apply(expectFor() as ExpectCall, thisArg, args)
    },
    get(target, key, receiver) {
      const inner = expectFor()
      if (key in inner) {
        return Reflect.get(inner, key, inner)
      }
      return Reflect.get(target, key, receiver)
    },
  })
}

export const guardedExpect = (real: object, createExpect?: CreateExpect): object =>
  createExpect === undefined
    ? new Proxy(real, {
      apply(target, thisArg, args) {
        return isExpectCall(target) ? flagCurrentTest(Reflect.apply(target, thisArg, args) as object) : target
      },
    })
    : dispatcherExpect(real, createExpect)

export const guardedVi = (real: object): object => real
