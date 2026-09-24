import * as Boolean from 'effect/Boolean'
import { dual } from 'effect/Function'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Predicate from 'effect/Predicate'

import type {
  EachApi,
  EachFn,
  EachSuiteBody,
  HarnessApi,
  HarnessTestFunction,
  HookKind,
  HookSets,
  RegistrySuiteApi,
  RegistryTestApi,
  SuiteBody,
  SuiteEachApi,
  SuiteVariants,
  TestFunctionWithTimeout,
  TestMode,
  TestOptions,
  TestRegistry,
  VariantApi,
} from './registry.schema.js'

const descriptorValueOf = <A>(descriptor: TypedPropertyDescriptor<A> | undefined): A | undefined =>
  Option.getOrUndefined(Option.fromNullishOr(descriptor?.value))

const propertyOf = <A = unknown>(row: A, key: string): A | undefined =>
  Boolean.match(Predicate.isObject(row), {
    onTrue: () => descriptorValueOf<A>(Object.getOwnPropertyDescriptor(row, key)),
    onFalse: () => undefined,
  })

const formatScalar = <A = unknown>(value: A): string =>
  Match.value(typeof value).pipe(
    Match.when('string', () => String(value)),
    Match.when('number', () => String(value)),
    Match.when('boolean', () => String(value)),
    Match.when('bigint', () => String(value)),
    Match.orElse(() => JSON.stringify(value)),
  )

const templateValue = <A = unknown>(row: A, key: string): string => {
  const value = propertyOf(row, key)
  return Match.value(value === undefined).pipe(
    Match.when(true, () => ''),
    Match.when(false, () => formatScalar(value)),
    Match.exhaustive,
  )
}

const replaceToken = <A = unknown>(token: string, next: () => A | undefined, index: () => number): string =>
  Match.value(token).pipe(
    Match.when('%%', () => '%'),
    Match.when('%i', () => String(Number.parseInt(String(next()), 10))),
    Match.when('%f', () => String(Number.parseFloat(String(next())))),
    Match.when('%d', () => String(Number(next()))),
    Match.when('%j', () => JSON.stringify(next())),
    Match.when('%#', () => {
      next()
      return String(index())
    }),
    Match.orElse(() => {
      const value = next()
      return Match.value(typeof value === 'object').pipe(
        Match.when(true, () => JSON.stringify(value)),
        Match.when(false, () => String(value)),
        Match.exhaustive,
      )
    }),
  )

const formatEachNameImpl = <A = unknown>(template: string, row: A): string => {
  const values: ReadonlyArray<A> = Array.isArray(row) ? row : [row]
  let index = 0
  const next = (): A | undefined => {
    const value = values[index]
    index += 1
    return value
  }
  const currentIndex = (): number => index

  return template
    .replace(/%[%#d\difjs]/g, (token) => replaceToken(token, next, currentIndex))
    .replace(/\$\{([^}]+)\}/g, (_match, key: string) => templateValue(row, key))
    .replace(/\$([a-zA-Z_][a-zA-Z0-9_]*)/g, (_match, key: string) => templateValue(row, key))
}

export const formatEachName: {
  <A = unknown>(template: string, row: A): string
  <A = unknown>(row: A): (template: string) => string
} = dual(2, formatEachNameImpl)

const isTestFunction = <A>(
  value: TestFunctionWithTimeout<A> | TestOptions | number | undefined,
): value is TestFunctionWithTimeout<A> => Predicate.isFunction(value)

const resolveFn = (
  fnOrOptions: TestFunctionWithTimeout | TestOptions | undefined,
  maybeFn: TestFunctionWithTimeout | number | undefined,
): TestFunctionWithTimeout | undefined =>
  Match.value(fnOrOptions).pipe(
    Match.when(isTestFunction, (resolved) => resolved),
    Match.orElse(() => Option.getOrUndefined(Option.filter(Option.fromNullishOr(maybeFn), isTestFunction))),
  )

const eachArgsOf = (
  name: string | undefined,
  fn: EachFn | undefined,
): Option.Option<readonly [string, EachFn]> => Option.all([Option.fromNullishOr(name), Option.fromNullishOr(fn)])

const suiteEachArgsOf = (
  name: string | undefined,
  body: EachSuiteBody | undefined,
): Option.Option<readonly [string, EachSuiteBody]> =>
  Option.all([Option.fromNullishOr(name), Option.fromNullishOr(body)])

const createVariantApi = (registry: TestRegistry, mode: TestMode, inverted: boolean): VariantApi => {
  const at = (): readonly number[] => registry.frames.current
  const bindEach = <A = unknown>(cases: readonly A[]) => (name: string, fn: EachFn) => {
    cases.forEach((row) => {
      const args: readonly A[] = Array.isArray(row) ? row : [row]
      registry.registerTest(formatEachName(name, row), at(), mode, inverted, (context) => fn(...args, context))
    })
  }
  const each: EachApi = (cases, name, fn) =>
    Option.match(eachArgsOf(name, fn), {
      onNone: () => bindEach(cases),
      onSome: ([resolvedName, resolvedFn]) => bindEach(cases)(resolvedName, resolvedFn),
    })
  return Object.assign(
    (
      name: string,
      fnOrOptions?: TestFunctionWithTimeout | TestOptions,
      maybeFn?: TestFunctionWithTimeout | number,
    ) => {
      registry.registerTest(name, at(), mode, inverted, resolveFn(fnOrOptions, maybeFn))
    },
    { each, for: each },
  )
}

const createIt = (registry: TestRegistry): RegistryTestApi => {
  const each = createVariantApi(registry, 'run', false).each
  return Object.assign(
    (
      name: string,
      fnOrOptions?: TestFunctionWithTimeout | TestOptions,
      maybeFn?: TestFunctionWithTimeout | number,
    ) => {
      registry.registerTest(name, registry.frames.current, 'run', false, resolveFn(fnOrOptions, maybeFn))
    },
    {
      skip: createVariantApi(registry, 'skip', false),
      only: createVariantApi(registry, 'only', false),
      fails: createVariantApi(registry, 'run', true),
      todo: (name: string) => registry.registerTest(name, registry.frames.current, 'todo', false, undefined),
      each,
      for: each,
    },
  )
}

const createDescribe = (registry: TestRegistry, it: RegistryTestApi): RegistrySuiteApi => {
  const open = (name: string, mode: TestMode, invoke: (api: RegistryTestApi) => void): void => {
    const previous = registry.frames.current
    const suite = registry.registerSuite(name, previous, mode)
    registry.frames.current = [...previous, suite.id]
    try {
      invoke(it)
    } finally {
      registry.frames.current = previous
    }
  }
  const variant = (mode: TestMode): SuiteVariants => {
    const bindEach = <A = unknown>(cases: readonly A[]) => (name: string, body: EachSuiteBody) => {
      cases.forEach((row) => {
        const args: readonly A[] = Array.isArray(row) ? row : [row]
        open(formatEachName(name, row), mode, (api) => body(...args, api))
      })
    }
    const each: SuiteEachApi = (cases, name, body) =>
      Option.match(suiteEachArgsOf(name, body), {
        onNone: () => bindEach(cases),
        onSome: ([resolvedName, resolvedBody]) => bindEach(cases)(resolvedName, resolvedBody),
      })
    return Object.assign((name: string, body: SuiteBody) => open(name, mode, body), { each, for: each })
  }
  const each = variant('run').each
  return Object.assign((name: string, body: SuiteBody) => open(name, 'run', body), {
    skip: variant('skip'),
    only: variant('only'),
    todo: (name: string) => open(name, 'todo', () => {}),
    each,
    for: each,
  })
}

const hookAt = (registry: TestRegistry, kind: HookKind, hook: HarnessTestFunction): void => {
  const innermost = registry.frames.current.at(-1)
  const target: HookSets | undefined = Option.match(Option.fromNullishOr(innermost), {
    onNone: () => registry.rootHooks,
    onSome: (id) => registry.suiteHooks.get(id),
  })
  target?.[kind].push(hook)
}

export const createHarnessApi = (registry: TestRegistry): HarnessApi => {
  const it = createIt(registry)
  const describe = createDescribe(registry, it)
  return {
    describe,
    suite: describe,
    it,
    test: it,
    hooks: {
      beforeAll: (hook) => hookAt(registry, 'beforeAll', hook),
      afterAll: (hook) => hookAt(registry, 'afterAll', hook),
      beforeEach: (hook) => hookAt(registry, 'beforeEach', hook),
      afterEach: (hook) => hookAt(registry, 'afterEach', hook),
      onTestFinished: (finalizer) =>
        Option.match(Option.fromNullishOr(registry.currentTest), {
          onNone: () => {
            throw new Error('onTestFinished must be called while a test is running')
          },
          onSome: (current) => current.onTestFinished(finalizer),
        }),
    },
  }
}
