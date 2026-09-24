import { dual } from 'effect/Function'

import { reflectiveValue } from './mocking/mocker.js'
import { workerStateOf } from './sandbox-state.handle.js'
import { currentSnapshotTest, type SnapshotTask, snapshotTaskOf, type SnapshotTest } from './snapshot-test.js'

interface ExpectWithTest {
  readonly withTest: (test: SnapshotTask) => object
}

const isObjectLike = <A = unknown>(value: A): value is A & object => typeof value === 'object' && value !== null

const asNonNullObject = <A = unknown>(value: A): object | undefined => isObjectLike(value) ? value : undefined

const hasTestTag = (value: object): boolean => typeof Reflect.get(value, 'withTest') === 'function'

const isExpectWithTest = <A = unknown>(value: A): value is A & ExpectWithTest =>
  isObjectLike(value) && hasTestTag(value)

const taggedAssertion = (assertion: ExpectWithTest, test: SnapshotTest): object =>
  assertion.withTest(snapshotTaskOf(test))

const withCurrentTest = <A = unknown>(assertion: A, test: SnapshotTest): A | object =>
  isExpectWithTest(assertion) ? taggedAssertion(assertion, test) : assertion

const flagCurrentTest = <A = unknown>(assertion: A): A | object => {
  const test = currentSnapshotTest()
  return test === undefined ? assertion : withCurrentTest(assertion, test)
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

const currentRunnerTask = (): object | undefined => {
  const workerState = workerStateOf()
  return workerState === undefined
    ? undefined
    : asNonNullObject(Reflect.get(workerState, 'current', workerState))
}

const builtExpectOf = (perTask: WeakMap<object, object>, createExpect: CreateExpect, task: object): object => {
  const built = createExpect(task)
  perTask.set(task, built)
  return built
}

const expectForTask = (perTask: WeakMap<object, object>, createExpect: CreateExpect, task: object): object => {
  const cached = perTask.get(task)
  return cached === undefined ? builtExpectOf(perTask, createExpect, task) : cached
}

const dispatcherExpect = (real: object, createExpect: CreateExpect): object => {
  const perTask = new WeakMap<object, object>()
  const expectFor = (): object => {
    const task = currentRunnerTask()
    return task === undefined ? real : expectForTask(perTask, createExpect, task)
  }
  return new Proxy(real, {
    apply(_target, thisArg, args) {
      const inner = expectFor()
      return isExpectCall(inner) ? reflectiveValue(Reflect.apply(inner, thisArg, args)) : inner
    },
    get(target, key, receiver) {
      const inner = expectFor()
      return key in inner
        ? reflectiveValue(Reflect.get(inner, key, inner))
        : reflectiveValue(Reflect.get(target, key, receiver))
    },
  })
}

export const guardedExpect = (real: object): object =>
  new Proxy(real, {
    apply(target, thisArg, args) {
      return isExpectCall(target)
        ? flagCurrentTest(reflectiveValue(Reflect.apply(target, thisArg, args)))
        : target
    },
  })

/**
 * The same guard as {@link guardedExpect}, but backed by Vitest's `createExpect`
 * factory so every assertion is tagged with the test it was created for.
 * Data-last (`dispatchingExpect(createExpect)(real)`) and data-first
 * (`dispatchingExpect(real, createExpect)`) both resolve to the dispatcher.
 */
export const dispatchingExpect: {
  (createExpect: CreateExpect): (real: object) => object
  (real: object, createExpect: CreateExpect): object
} = dual(2, (real: object, createExpect: CreateExpect): object => dispatcherExpect(real, createExpect))

export const guardedVi = (real: object): object => real
