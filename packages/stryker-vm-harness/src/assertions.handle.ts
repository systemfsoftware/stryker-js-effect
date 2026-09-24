import { dual } from 'effect/Function'

import { currentSnapshotTest, type SnapshotTask, snapshotTaskOf, type SnapshotTest } from './snapshot-test.js'

interface ExpectWithTest {
  readonly withTest: (test: SnapshotTask) => object
}

type ReflectedValue = object | string | number | boolean | symbol | bigint | null | undefined

const REFLECTED_TYPEOF: Record<string, boolean> = {
  undefined: true,
  function: true,
  object: true,
  boolean: true,
  number: true,
  bigint: true,
  string: true,
  symbol: true,
}

const isReflectedValue = (value: unknown): value is ReflectedValue => REFLECTED_TYPEOF[typeof value] === true

const asReflectedValue = <A = unknown>(value: A): ReflectedValue => (isReflectedValue(value) ? value : undefined)

const memberOf = <A = unknown>(source: object, key: PropertyKey, receiver: A): ReflectedValue =>
  asReflectedValue(Reflect.get(source, key, receiver))

const isObjectLike = <A = unknown>(value: A): value is A & object => typeof value === 'object' && value !== null

const isFunctionOrObject = (value: unknown): value is object =>
  typeof value === 'object' ? value !== null : typeof value === 'function'

const asReferenceValue = <A = unknown>(value: A): object | undefined => isFunctionOrObject(value) ? value : undefined

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

const workerStateOf = (): object | undefined => asReferenceValue(memberOf(globalThis, '__vitest_worker__', globalThis))

const currentRunnerTask = (): object | undefined => {
  const workerState = workerStateOf()
  return workerState === undefined
    ? undefined
    : asNonNullObject(memberOf(workerState, 'current', workerState))
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
      return isExpectCall(inner) ? asReflectedValue(Reflect.apply(inner, thisArg, args)) : inner
    },
    get(target, key, receiver) {
      const inner = expectFor()
      return key in inner ? memberOf(inner, key, inner) : memberOf(target, key, receiver)
    },
  })
}

export const guardedExpect: {
  (createExpect?: CreateExpect): (real: object) => object
  (real: object, createExpect?: CreateExpect): object
} = dual(
  (args: IArguments): boolean => args.length >= 1,
  (real: object, createExpect?: CreateExpect): object =>
    createExpect === undefined
      ? new Proxy(real, {
        apply(target, thisArg, args) {
          return isExpectCall(target)
            ? flagCurrentTest(asReflectedValue(Reflect.apply(target, thisArg, args)))
            : target
        },
      })
      : dispatcherExpect(real, createExpect),
)

export const guardedVi = (real: object): object => real
