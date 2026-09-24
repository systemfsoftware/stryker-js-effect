import { createRequire } from 'node:module'

import * as Option from 'effect/Option'
import * as Result from 'effect/Result'

import { usedFixtureProps } from './fixture-props.js'
import { createFixtureRegistry, extendFixtures, overrideFixtures } from './fixtures.js'
import type {
  FixtureFunction,
  FixtureHost,
  FixtureOptions,
  FixtureRegistry,
  FixtureTable,
  FixtureTableValue,
  FixtureUse,
  FixtureValue,
} from './fixtures.js'
import { tagsForChain } from './registry.handle.js'
import type {
  AroundHookFunction,
  AroundKind,
  AroundRegistration,
  BuilderFixtureOptions,
  BuilderScopeName,
  ChainableVariantApi,
  EachApi,
  EachFn,
  EachNameOptions,
  EachSuiteBody,
  EachValue,
  EachValueFormatter,
  ForApi,
  ForFn,
  ForSuiteBody,
  HarnessApi,
  HarnessHookFunction,
  HarnessTestFunction,
  HookApi,
  HookKind,
  ParsedTestArguments,
  RegisteredHook,
  RegisteredSuite,
  RegistrySuiteApi,
  RegistryTestApi,
  SuiteBody,
  SuiteEachApi,
  SuiteForApi,
  SuiteOptions,
  SuiteRegistration,
  SuiteVariants,
  TemplateRow,
  TestContext,
  TestFunctionWithTimeout,
  TestMode,
  TestOptions,
  TestRegistry,
  VariantApi,
} from './registry.schema.js'

export const parseTestArguments = (
  fnOrOptions: TestFunctionWithTimeout | TestOptions | undefined,
  maybeFnOrTimeout: TestFunctionWithTimeout | number | undefined,
): ParsedTestArguments => {
  if (maybeFnOrTimeout !== undefined && typeof maybeFnOrTimeout === 'object') {
    throw new TypeError(
      'Signature "test(name, fn, { ... })" was deprecated in Vitest 3 and removed in Vitest 4. Please, provide options as a second argument instead.',
    )
  }
  let options: TestOptions = {}
  let fn: HarnessTestFunction | undefined
  if (typeof maybeFnOrTimeout === 'number') {
    options = { timeout: maybeFnOrTimeout }
  } else if (typeof fnOrOptions === 'object') {
    options = fnOrOptions
  }
  if (typeof fnOrOptions === 'function') {
    if (typeof maybeFnOrTimeout === 'function') {
      throw new TypeError('Cannot use two functions as arguments. Please use the second argument for options.')
    }
    fn = fnOrOptions
  } else if (typeof maybeFnOrTimeout === 'function') {
    fn = maybeFnOrTimeout
  }
  return { options, fn }
}

const modeOf = (flags: TestOptions, hasFn: boolean): TestMode => {
  const mode: TestMode = flags.only === true
    ? 'only'
    : flags.skip === true
    ? 'skip'
    : flags.todo === true
    ? 'todo'
    : 'run'
  return mode === 'run' && !hasFn ? 'todo' : mode
}

const eachValueOf = <A = unknown>(value: A): EachValue => value as EachValue

export const isTemplateTable = (cases: unknown): cases is TemplateStringsArray =>
  Array.isArray(cases) && Object.hasOwn(cases as object, 'raw')

export const templateRowsOf = (
  cases: TemplateStringsArray,
  rows: ReadonlyArray<EachValue>,
): ReadonlyArray<TemplateRow> => {
  const header = cases
    .join('')
    .trim()
    .replace(/ /gu, '')
    .split('\n')
    .map((line) => line.split('|'))[0] ?? []
  const table: Array<TemplateRow> = []
  for (let index = 0; index < Math.floor(rows.length / header.length); index += 1) {
    const row: TemplateRow = {}
    for (let column = 0; column < header.length; column += 1) {
      const key = header[column]
      if (key !== undefined) {
        row[key] = rows[index * header.length + column]
      }
    }
    table.push(row)
  }
  return table
}
export const createVariantApi = (registry: TestRegistry, mode: TestMode, inverted: boolean): VariantApi => {
  const at = (): readonly number[] => registry.frames.current
  const chainOf = (): ReadonlyArray<RegisteredSuite> =>
    at().map((id) => registry.suites.get(id)).filter((suite) => suite !== undefined)
  const inheritedConcurrent = (): boolean => chainOf().some((suite) => suite.concurrent === true)
  const bindEach = <A = unknown>(cases: readonly A[]) => (name: string, fn: EachFn<A>) => {
    for (const [index, row] of cases.entries()) {
      const args: readonly A[] = Array.isArray(row) ? row : [row]
      const chain = chainOf()
      registry.registerTest(
        formatEachName(name, eachValueOf(row), { index }),
        at(),
        mode,
        inverted,
        () => fn(...args),
        {
          timeout: [...chain].reverse().find((suite) => suite.timeout !== undefined)?.timeout,
          retry: [...chain].reverse().find((suite) => suite.retry !== undefined)?.retry,
          repeats: [...chain].reverse().find((suite) => suite.repeats !== undefined)?.repeats,
          concurrent: inheritedConcurrent(),
          shuffle: chain.some((suite) => suite.shuffle === true),
          each: true,
          fixtures: undefined,
        },
      )
    }
  }
  const each: EachApi = ((
    cases: ReadonlyArray<EachValue> | TemplateStringsArray,
    ...rest: ReadonlyArray<EachValue>
  ) => {
    if (isTemplateTable(cases)) {
      const rows = templateRowsOf(cases, rest)
      return (tableName: string, tableFn: EachFn<TemplateRow>) => bindEach(rows)(tableName, tableFn)
    }
    if (rest.length === 0) {
      return Array.isArray(cases) ? bindEach(cases) : bindEach([])
    }
    const name = rest[0]
    const fn = rest[1] as EachFn<EachValue> | undefined
    if (!Array.isArray(cases) || typeof name !== 'string' || typeof fn !== 'function') {
      return bindEach([])
    }
    return bindEach(cases)(name, fn)
  }) as EachApi
  const table = bindForOf(registry, { inverted, flags: {}, fixtures: undefined }, {})
  return Object.assign(
    (
      name: string,
      fnOrOptions?: TestFunctionWithTimeout | TestOptions,
      maybeFn?: TestFunctionWithTimeout | number,
    ) => {
      registry.registerTest(name, at(), mode, inverted, parseTestArguments(fnOrOptions, maybeFn).fn)
    },
    { each, for: table },
  )
}

const tagsOf = (tags: string | ReadonlyArray<string> | undefined): ReadonlyArray<string> | undefined =>
  tags === undefined ? undefined : typeof tags === 'string' ? [tags] : [...tags]

const registerCollected = (
  registry: TestRegistry,
  base: CollectorBase,
  flags: TestOptions,
  name: string,
  fnOrOptions: TestFunctionWithTimeout | TestOptions | undefined,
  maybeFn: TestFunctionWithTimeout | number | undefined,
): void => {
  const parsed = parseTestArguments(fnOrOptions, maybeFn)
  const merged: TestOptions = { ...base.flags, ...flags, ...parsed.options }
  const mode = modeOf(merged, parsed.fn !== undefined)
  const inverted = base.inverted || merged.fails === true
  const suiteChain = registry.frames.current.map((id) => registry.suites.get(id)).filter((suite) => suite !== undefined)
  const concurrent = merged.concurrent ?? suiteChain.some((suite) => suite.concurrent === true)
  const timeout = merged.timeout ?? [...suiteChain].reverse().find((suite) => suite.timeout !== undefined)?.timeout
  const retry = merged.retry ?? [...suiteChain].reverse().find((suite) => suite.retry !== undefined)?.retry
  const repeats = merged.repeats ?? [...suiteChain].reverse().find((suite) => suite.repeats !== undefined)?.repeats
  registry.registerTest(name, registry.frames.current, mode, inverted, parsed.fn, {
    timeout,
    retry,
    repeats,
    concurrent,
    shuffle: suiteChain.some((suite) => suite.shuffle === true),
    each: merged.each ?? false,
    tags: tagsForChain(registry, registry.frames.current, tagsOf(merged.tags)),
    fixtures: base.fixtures,
  })
}
interface CollectorBase {
  readonly inverted: boolean
  readonly flags: TestOptions
  readonly fixtures: FixtureRegistry | undefined
}

interface BuilderCleanupRegistrar {
  (fn: () => void | Promise<void>): void
}

export type BuilderFunctionContext = FixtureUse & {
  readonly onCleanup: BuilderCleanupRegistrar
}

export type BuilderFunction = (
  context: object,
  registrar: BuilderFunctionContext,
) => FixtureValue | Promise<FixtureValue> | void

const SINGLE_CLEANUP_MESSAGE =
  'onCleanup can only be called once per fixture. Define separate fixtures if you need multiple cleanup functions.'

const wrapBuilderFunction = (builder: BuilderFunction): FixtureFunction => {
  const wrapped = (context: object, use: FixtureUse): FixtureValue => {
    let cleanup: (() => void | Promise<void>) | undefined
    const registrar: BuilderFunctionContext = Object.assign(
      (): Promise<void> => {
        throw new TypeError(
          'Builder fixtures receive { onCleanup } as their second argument. Return the fixture value instead of calling use.',
        )
      },
      {
        onCleanup: (fn: () => void | Promise<void>): void => {
          if (cleanup !== undefined) {
            throw new Error(SINGLE_CLEANUP_MESSAGE)
          }
          cleanup = fn
        },
      },
    )
    return Promise.resolve()
      .then(() => builder(context, registrar))
      .then((value) => {
        if (value === undefined) {
          return use(undefined)
        }
        return use(value)
      })
      .then(() => (cleanup === undefined ? undefined : cleanup()))
      .then(() => undefined)
  }
  Object.defineProperty(wrapped, 'toString', { value: () => builder.toString(), enumerable: false })
  return wrapped
}

const builderValueOf = (value: FixtureTableValue | FixtureFunction | undefined): FixtureTableValue => {
  if (typeof value === 'function' && !Array.isArray(value)) {
    return wrapBuilderFunction(value as BuilderFunction)
  }
  if (value === undefined) {
    return undefined
  }
  return value
}

const builderOptionsOf = (options: BuilderFixtureOptions): FixtureOptions => {
  if (typeof options === 'string') {
    return { scope: options }
  }
  return options
}
const SCOPE_NAMES: ReadonlyArray<string> = ['test', 'file', 'worker']

const isScopeName = (
  value: FixtureTableValue | FixtureFunction | FixtureOptions | undefined,
): value is BuilderScopeName => typeof value === 'string' && SCOPE_NAMES.includes(value)

const builderTableOf = (
  first: FixtureTable | string,
  second: FixtureTableValue | FixtureFunction | FixtureOptions | undefined,
  third: FixtureTableValue | FixtureFunction | undefined,
): FixtureTable => {
  if (typeof first !== 'string') {
    return first
  }
  if (third !== undefined) {
    return { [first]: [builderValueOf(third), builderOptionsOf(second as BuilderFixtureOptions)] }
  }
  if (isScopeName(second)) {
    return { [first]: [undefined, { scope: second }] }
  }
  if (second !== undefined && typeof second === 'object' && !Array.isArray(second) && typeof second !== 'function') {
    return { [first]: [undefined, second as FixtureOptions] }
  }
  return { [first]: builderValueOf(second) }
}
const collectedApiOf = (registry: TestRegistry, base: CollectorBase): RegistryTestApi => {
  const variant = (flags: TestOptions): ChainableVariantApi => {
    const bound = ((
      name: string,
      fnOrOptions?: TestFunctionWithTimeout | TestOptions,
      maybeFn?: TestFunctionWithTimeout | number,
    ) => registerCollected(registry, base, flags, name, fnOrOptions, maybeFn)) as ChainableVariantApi
    Object.defineProperties(bound, {
      each: { get: (): EachApi => bindEachOf(registry, base, flags), enumerable: true },
      for: { get: (): ForApi => bindForOf(registry, base, flags), enumerable: true },
      concurrent: { get: (): ChainableVariantApi => variant({ ...flags, concurrent: true }), enumerable: true },
      skipIf: {
        get: (): (condition: boolean) => RegistryTestApi => (condition: boolean) =>
          collectedApiOf(registry, { ...base, flags: { ...base.flags, ...flags, skip: condition !== false } }),
        enumerable: true,
      },
      runIf: {
        get: (): (condition: boolean) => RegistryTestApi => (condition: boolean) =>
          collectedApiOf(registry, { ...base, flags: { ...base.flags, ...flags, skip: condition === false } }),
        enumerable: true,
      },
    })
    return bound
  }
  const root = variant({})
  const api =
    ((name: string, fnOrOptions?: TestFunctionWithTimeout | TestOptions, maybeFn?: TestFunctionWithTimeout | number) =>
      registerCollected(registry, base, {}, name, fnOrOptions, maybeFn)) as RegistryTestApi
  Object.defineProperties(api, {
    skip: { get: (): VariantApi => variant({ skip: true }), enumerable: true },
    only: { get: (): VariantApi => variant({ only: true }), enumerable: true },
    fails: { get: (): VariantApi => variant({ fails: true }), enumerable: true },
    todo: {
      value: (name: string) => {
        registry.registerTest(name, registry.frames.current, 'todo', false, undefined, {
          timeout: undefined,
          retry: undefined,
          repeats: undefined,
          concurrent: false,
          each: false,
          fixtures: base.fixtures,
        })
      },
      enumerable: true,
    },
    each: { get: (): EachApi => bindEachOf(registry, base, {}), enumerable: true },
    for: { get: (): ForApi => bindForOf(registry, base, {}), enumerable: true },
    concurrent: { get: (): ChainableVariantApi => variant({ concurrent: true }), enumerable: true },
    skipIf: { get: () => root.skipIf, enumerable: true },
    runIf: { get: () => root.runIf, enumerable: true },
    extend: {
      value: (
        first: FixtureTable | string,
        second?: FixtureTableValue | FixtureFunction | FixtureOptions,
        third?: FixtureTableValue | FixtureFunction,
      ) => {
        const table = builderTableOf(first, second, third)
        const extended = extendFixtures(
          base.fixtures ?? createFixtureRegistry(),
          table,
          registry.frames.current.length === 0,
        )
        if (Result.isFailure(extended)) {
          throw new Error(extended.failure.join('\n'))
        }
        return collectedApiOf(registry, { ...base, fixtures: extended.success })
      },
      enumerable: true,
    },
    override: {
      value: (
        first: FixtureTable | string,
        second?: FixtureTableValue | FixtureFunction | FixtureOptions,
        third?: FixtureTableValue | FixtureFunction,
      ) => {
        const table = builderTableOf(first, second, third)
        const overridden = overrideFixtures(
          base.fixtures ?? createFixtureRegistry(),
          innermostHostOf(registry),
          table,
          registry.frames.current.length === 0,
        )
        if (Result.isFailure(overridden)) {
          throw new Error(overridden.failure.join('\n'))
        }
        return collectedApiOf(registry, base)
      },
      enumerable: true,
    },
    scoped: {
      value: (
        first: FixtureTable | string,
        second?: FixtureTableValue | FixtureFunction | FixtureOptions,
        third?: FixtureTableValue | FixtureFunction,
      ) => {
        const chained = collectedApiOf(registry, base)
        if (typeof first !== 'string') {
          return chained.override(first)
        }
        if (third === undefined) {
          return second === undefined
            ? chained.override({ [first]: undefined })
            : chained.override(first, second)
        }
        if (typeof third === 'function') {
          return typeof second === 'function' || second === undefined
            ? chained.override(first, third)
            : chained.override(first, second as FixtureOptions, third)
        }
        return typeof second === 'function' || second === undefined
          ? chained.override(first, third as FixtureTableValue)
          : chained.override(first, second as FixtureOptions, third as FixtureTableValue)
      },
      enumerable: true,
    },
    describe: { value: createDescribe(registry), enumerable: true },
    suite: { value: createDescribe(registry), enumerable: true },
    beforeEach: {
      value: (hook: HarnessHookFunction, timeout?: number) => hookAt(registry, 'beforeEach', hook, timeout),
      enumerable: true,
    },
    afterEach: {
      value: (hook: HarnessHookFunction, timeout?: number) => hookAt(registry, 'afterEach', hook, timeout),
      enumerable: true,
    },
    beforeAll: {
      value: (hook: HarnessHookFunction, timeout?: number) => hookAt(registry, 'beforeAll', hook, timeout),
      enumerable: true,
    },
    afterAll: {
      value: (hook: HarnessHookFunction, timeout?: number) => hookAt(registry, 'afterAll', hook, timeout),
      enumerable: true,
    },
    aroundEach: {
      value: (hook: AroundHookFunction, timeout?: number) => aroundAt(registry, 'aroundEach', hook, timeout),
      enumerable: true,
    },
    aroundAll: {
      value: (hook: AroundHookFunction, timeout?: number) => aroundAt(registry, 'aroundAll', hook, timeout),
      enumerable: true,
    },
  })
  return api
}

const innermostHostOf = (registry: TestRegistry): FixtureHost | undefined => {
  const innermost = registry.frames.current.at(-1)
  if (innermost === undefined) {
    return undefined
  }
  return registry.suites.get(innermost)?.view
}

const bindEachOf = (
  registry: TestRegistry,
  base: CollectorBase,
  flags: TestOptions,
): EachApi => {
  const bind = <A = unknown>(cases: readonly A[]) => (name: string, fn: EachFn<A>) => {
    for (const [index, row] of cases.entries()) {
      const args: readonly A[] = Array.isArray(row) ? row : [row]
      const merged = { ...base.flags, ...flags }
      const mode = modeOf(merged, true)
      const suiteChain = registry.frames.current.map((id) => registry.suites.get(id)).filter((suite) =>
        suite !== undefined
      )
      const concurrent = merged.concurrent ?? suiteChain.some((suite) => suite.concurrent === true)
      const parsedNames = usedFixtureProps(fn.toString(), 1)
      registry.registerTest(
        formatEachName(name, eachValueOf(row), { index }),
        registry.frames.current,
        mode,
        base.inverted,
        () => fn(...args),
        {
          timeout: merged.timeout ?? [...suiteChain].reverse().find((suite) => suite.timeout !== undefined)?.timeout,
          retry: merged.retry ?? [...suiteChain].reverse().find((suite) => suite.retry !== undefined)?.retry,
          repeats: merged.repeats ?? [...suiteChain].reverse().find((suite) => suite.repeats !== undefined)?.repeats,
          concurrent,
          shuffle: suiteChain.some((suite) => suite.shuffle === true),
          each: true,
          tags: tagsForChain(registry, registry.frames.current, tagsOf(merged.tags)),
          fixtures: base.fixtures,
          fixtureNames: Result.isSuccess(parsedNames) ? parsedNames.success : new Set<string>(),
        },
      )
    }
  }
  const each: EachApi = ((
    cases: ReadonlyArray<EachValue> | TemplateStringsArray,
    ...rest: ReadonlyArray<EachValue>
  ) => {
    if (isTemplateTable(cases)) {
      const rows = templateRowsOf(cases, rest)
      return (tableName: string, tableFn: EachFn<TemplateRow>) => bind(rows)(tableName, tableFn)
    }
    if (rest.length === 0) {
      return Array.isArray(cases) ? bind(cases) : bind([])
    }
    const name = rest[0]
    const fn = rest[1] as EachFn<EachValue> | undefined
    if (!Array.isArray(cases) || typeof name !== 'string' || typeof fn !== 'function') {
      return bind([])
    }
    return bind(cases)(name, fn)
  }) as EachApi
  return each
}
const bindForOf = (
  registry: TestRegistry,
  base: CollectorBase,
  flags: TestOptions,
): ForApi => {
  const bind = <A = unknown>(cases: readonly A[]) => (name: string, fn: ForFn<A>) => {
    for (const [index, row] of cases.entries()) {
      const merged = { ...base.flags, ...flags }
      const mode = modeOf(merged, true)
      const suiteChain = registry.frames.current.map((id) => registry.suites.get(id)).filter((suite) =>
        suite !== undefined
      )
      const concurrent = merged.concurrent ?? suiteChain.some((suite) => suite.concurrent === true)
      const parsedNames = usedFixtureProps(fn.toString(), 1)
      registry.registerTest(
        formatEachName(name, eachValueOf(row as EachValue), { index }),
        registry.frames.current,
        mode,
        base.inverted,
        (context) => fn(row, context),
        {
          timeout: merged.timeout ?? [...suiteChain].reverse().find((suite) => suite.timeout !== undefined)?.timeout,
          retry: merged.retry ?? [...suiteChain].reverse().find((suite) => suite.retry !== undefined)?.retry,
          repeats: merged.repeats ?? [...suiteChain].reverse().find((suite) => suite.repeats !== undefined)?.repeats,
          concurrent,
          shuffle: suiteChain.some((suite) => suite.shuffle === true),
          each: true,
          fixtures: base.fixtures,
          fixtureNames: Result.isSuccess(parsedNames) ? parsedNames.success : new Set<string>(),
        },
      )
    }
  }
  const table: ForApi = ((
    cases: ReadonlyArray<EachValue> | TemplateStringsArray,
    ...rest: ReadonlyArray<EachValue>
  ) => {
    if (isTemplateTable(cases)) {
      const rows = templateRowsOf(cases, rest)
      return (tableName: string, tableFn: ForFn<TemplateRow>) => bind(rows)(tableName, tableFn)
    }
    if (rest.length === 0) {
      return Array.isArray(cases) ? bind(cases) : bind([])
    }
    const name = rest[0]
    const fn = rest[1] as ForFn<EachValue> | undefined
    if (!Array.isArray(cases) || typeof name !== 'string' || typeof fn !== 'function') {
      return bind([])
    }
    return bind(cases)(name, fn)
  }) as ForApi
  return table
}
export const createIt = (registry: TestRegistry): RegistryTestApi =>
  collectedApiOf(registry, { inverted: false, flags: {}, fixtures: undefined })

export const createDescribe = (registry: TestRegistry): RegistrySuiteApi => {
  const open = (
    name: string,
    mode: TestMode,
    registration: SuiteRegistration,
    invoke: (api: RegistryTestApi) => void,
  ): void => {
    const previous = registry.frames.current
    const suite = registry.registerSuite(name, previous, mode, registration)
    registry.frames.current = [...previous, suite.id]
    try {
      invoke(createIt(registry))
    } finally {
      registry.frames.current = previous
    }
  }
  const openWithArgs = (
    name: string,
    mode: TestMode,
    concurrent: boolean,
    chainShuffle: boolean | undefined,
    options: SuiteOptions | SuiteBody,
    body: SuiteBody | undefined,
  ): void => {
    const resolvedBody = typeof options === 'function' ? options : body
    if (resolvedBody === undefined) {
      throw new TypeError('Suite body must be a function')
    }
    const resolvedOptions: SuiteOptions = typeof options === 'function' ? {} : options
    open(name, mode, {
      concurrent,
      shuffle: resolvedOptions.shuffle ?? chainShuffle,
      timeout: resolvedOptions.timeout,
      retry: resolvedOptions.retry,
      repeats: resolvedOptions.repeats,
    }, resolvedBody)
  }
  const variant = (mode: TestMode, concurrent: boolean, shuffle?: boolean): SuiteVariants => {
    const bindEach = <A = unknown>(cases: readonly A[]) => (name: string, body: EachSuiteBody) => {
      for (const [index, row] of cases.entries()) {
        const args: readonly A[] = Array.isArray(row) ? row : [row]
        open(formatEachName(name, eachValueOf(row), { index }), mode, { concurrent, shuffle }, (_api) => body(...args))
      }
    }
    const bindTable = <A = unknown>(cases: readonly A[]) => (name: string, body: ForSuiteBody<A>) => {
      for (const [index, row] of cases.entries()) {
        open(
          formatEachName(name, eachValueOf(row as EachValue), { index }),
          mode,
          { concurrent, shuffle },
          () => body(row),
        )
      }
    }
    const each: SuiteEachApi = ((
      cases: ReadonlyArray<EachValue> | TemplateStringsArray,
      ...rest: ReadonlyArray<EachValue>
    ) => {
      if (isTemplateTable(cases)) {
        const rows = templateRowsOf(cases, rest)
        return (tableName: string, tableBody: EachSuiteBody) => bindEach(rows)(tableName, tableBody)
      }
      if (rest.length === 0) {
        return Array.isArray(cases) ? bindEach(cases) : bindEach([])
      }
      const name = rest[0]
      const body = rest[1] as EachSuiteBody | undefined
      if (!Array.isArray(cases) || typeof name !== 'string' || typeof body !== 'function') {
        return bindEach([])
      }
      return bindEach(cases)(name, body)
    }) as SuiteEachApi
    const table: SuiteForApi = ((
      cases: ReadonlyArray<EachValue> | TemplateStringsArray,
      ...rest: ReadonlyArray<EachValue>
    ) => {
      if (isTemplateTable(cases)) {
        const rows = templateRowsOf(cases, rest)
        return (tableName: string, tableBody: ForSuiteBody<TemplateRow>) => bindTable(rows)(tableName, tableBody)
      }
      if (rest.length === 0) {
        return Array.isArray(cases) ? bindTable(cases) : bindTable([])
      }
      const name = rest[0]
      const body = rest[1] as ForSuiteBody<EachValue> | undefined
      if (!Array.isArray(cases) || typeof name !== 'string' || typeof body !== 'function') {
        return bindTable([])
      }
      return bindTable(cases)(name, body)
    }) as SuiteForApi
    const callable =
      ((name: string, optionsOrBody: SuiteOptions | SuiteBody, maybeBody?: SuiteBody) =>
        openWithArgs(name, mode, concurrent, shuffle, optionsOrBody, maybeBody)) as SuiteVariants
    return Object.assign(callable, { each, for: table })
  }
  const suiteApi = (concurrent: boolean, chainShuffle?: boolean): RegistrySuiteApi =>
    Object.assign(
      ((name: string, optionsOrBody: SuiteOptions | SuiteBody, maybeBody?: SuiteBody) =>
        openWithArgs(name, 'run', concurrent, chainShuffle, optionsOrBody, maybeBody)) as RegistrySuiteApi,
      {
        skip: variant('skip', concurrent),
        only: variant('only', concurrent),
        todo: (name: string) => open(name, 'todo', { concurrent }, () => {}),
        each: variant('run', concurrent).each,
        for: variant('run', concurrent).for,
        concurrent: variant('run', true),
        shuffle: variant('run', concurrent, true),
        skipIf: (condition: boolean) => (condition ? suiteApi(concurrent).skip : suiteApi(concurrent)),
        runIf: (condition: boolean) => (condition ? suiteApi(concurrent) : suiteApi(concurrent).skip),
      },
    )
  return suiteApi(false)
}
const hookAt = (registry: TestRegistry, kind: HookKind, hook: HarnessHookFunction, timeout?: number): void => {
  const innermost = registry.frames.current.at(-1)
  const registered: RegisteredHook = { fn: hook, timeout }
  if (innermost === undefined) {
    registry.rootHooksFor(registry.files.current)[kind].push(registered)
    return
  }
  registry.suiteHooks.get(innermost)?.[kind].push(registered)
}
const aroundAt = (registry: TestRegistry, kind: AroundKind, hook: AroundHookFunction, timeout?: number): void => {
  const innermost = registry.frames.current.at(-1)
  const registered: AroundRegistration = { hook, timeout }
  if (innermost === undefined) {
    registry.rootAroundFor(registry.files.current)[kind].push(registered)
    return
  }
  registry.suiteAround.get(innermost)?.[kind].push(registered)
}

const currentTestOf = (registry: TestRegistry): TestContext => {
  const current = Option.fromNullishOr(registry.currentTest)
  return Option.match(current, {
    onNone: () => {
      throw new Error('onTestFinished must be called while a test is running')
    },
    onSome: (context) => context as TestContext,
  })
}

export const createHarnessApi = (registry: TestRegistry): HarnessApi => {
  const it = createIt(registry)
  const describe = createDescribe(registry)
  const hookApi: HookApi = {
    beforeAll: (hook, timeout) => hookAt(registry, 'beforeAll', hook, timeout),
    afterAll: (hook, timeout) => hookAt(registry, 'afterAll', hook, timeout),
    beforeEach: (hook, timeout) => hookAt(registry, 'beforeEach', hook, timeout),
    afterEach: (hook, timeout) => hookAt(registry, 'afterEach', hook, timeout),
    aroundEach: (hook, timeout) => aroundAt(registry, 'aroundEach', hook, timeout),
    aroundAll: (hook, timeout) => aroundAt(registry, 'aroundAll', hook, timeout),
    onTestFinished: (finalizer, timeout) => {
      currentTestOf(registry).onTestFinished(finalizer, timeout)
    },
    onTestFailed: (handler, timeout) => {
      currentTestOf(registry).onTestFailed(handler, timeout)
    },
  }
  return {
    describe,
    suite: describe,
    it,
    test: it,
    hooks: hookApi,
    beforeAll: hookApi.beforeAll,
    afterAll: hookApi.afterAll,
    beforeEach: hookApi.beforeEach,
    afterEach: hookApi.afterEach,
    aroundEach: hookApi.aroundEach,
    aroundAll: hookApi.aroundAll,
    onTestFinished: hookApi.onTestFinished,
    onTestFailed: hookApi.onTestFailed,
    inject: (name: string) => registry.provided.current[name],
  }
}

/**
 * `test.each` / `describe.each` title formatting, ported from Vitest 5.0.1's
 * `formatTitle` (dist/chunks/run.*.js) together with the token formatter it
 * delegates to (`@vitest/utils/display`'s `format`), so a table row produces
 * the exact name Vitest generates for it.
 *
 * Faithful pieces: the `%[sdjifoOc%]` token set, where every matched token
 * consumes one row item — `%%` consumes too and renders `%` followed by the
 * item it consumed, `%c` consumes and renders nothing; the `%#`/`%$` pre-pass
 * (0-based `%#`, 1-based `%$`, `%%` escaped around it); the `%f` pre-pass that
 * renders negative NaN and negative zero as `-%f`; the `%`-character-count
 * guard (`consumed < count`), so a token the row cannot feed formats
 * `undefined` while a token past that count stays literal; `%d`/`%i`/`%f`
 * coercion through `Number`/`Number.parseInt(String(...))`; `%j` rendering
 * `undefined` for a value JSON cannot represent; and the `$`-attribute rules
 * (object attributes read the first row item, numeric keys read the row list,
 * `$name` on a non-object row stays literal, and a string value is truncated
 * rather than quoted).
 *
 * Object/array/non-primitive values render with Vitest's own display formatter
 * (`@vitest/utils/display`, resolved from the user's vitest install, 40-character
 * budget by default); that formatter stays injectable, and the fallback when the
 * module cannot be resolved is JSON.
 */

export const DEFAULT_TITLE_VALUE_FORMAT_TRUNCATE = 40

interface VitestDisplay {
  readonly inspect: (value: EachValue, options?: { truncate?: number }) => string
}

const DISPLAY_SPECIFIER = '@vitest/utils/display'

const toDisplay = (loaded: object | null | undefined): VitestDisplay | undefined => {
  if (loaded === null || loaded === undefined || !('inspect' in loaded)) {
    return undefined
  }
  const inspect = loaded.inspect
  return typeof inspect === 'function'
    ? { inspect: inspect as VitestDisplay['inspect'] }
    : undefined
}

let resolvedDisplay: VitestDisplay | undefined
let displayResolved = false

const displayOf = (): VitestDisplay | undefined => {
  if (displayResolved) {
    return resolvedDisplay
  }
  displayResolved = true
  try {
    const requireHarness = createRequire(import.meta.url)
    const vitestPackageJson = requireHarness.resolve('vitest/package.json')
    const requireVitest = createRequire(vitestPackageJson)
    resolvedDisplay = toDisplay(requireVitest(DISPLAY_SPECIFIER) as object)
  } catch {
    resolvedDisplay = undefined
  }
  return resolvedDisplay
}

const FORMAT_TOKENS = /%[sdjifoOc%]/g
const ATTRIBUTE_TOKENS = /\$([$\p{ID_Continue}.]+)/gu
const ESCAPED_PERCENT = '__vitest_escaped_%__'

const isObjectValue = (value: EachValue): value is object =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isNegativeZero = (value: EachValue): boolean => typeof value === 'number' && value === 0 && 1 / value < 0

const jsonFormatValue: EachValueFormatter = (value) => {
  if (typeof value === 'bigint') {
    return `${value.toString()}n`
  }
  if (isNegativeZero(value)) {
    return '-0'
  }
  if (typeof value === 'symbol') {
    return value.toString()
  }
  if (typeof value === 'string') {
    return value
  }
  if (value === null || typeof value !== 'object') {
    return String(value)
  }
  return String(JSON.stringify(value))
}

export const defaultFormatValue = (value: EachValue, truncate?: number): string => {
  const display = displayOf()
  if (display === undefined) {
    return jsonFormatValue(value)
  }
  return display.inspect(value, { truncate: truncate ?? DEFAULT_TITLE_VALUE_FORMAT_TRUNCATE })
}

const objectAttr = (source: EachValue, path: string, fallback: EachValue): EachValue => {
  const segments = path.replace(/\[(\d+)\]/g, '.$1').split('.')
  let result: EachValue = source
  for (const segment of segments) {
    result = (Object(result) as Record<string, EachValue>)[segment]
    if (result === undefined) {
      return fallback
    }
  }
  return result
}

const NAN_SIGN_BUFFER = new ArrayBuffer(8)

const isNegativeNaN = (value: EachValue): boolean => {
  if (typeof value !== 'number' || !Number.isNaN(value)) {
    return false
  }
  const f64 = new Float64Array(NAN_SIGN_BUFFER)
  f64[0] = value
  return (new Uint32Array(NAN_SIGN_BUFFER).at(1) ?? 0) >>> 31 === 1
}

const truncateString = (value: string, maxLength: number): string => {
  if (value.length <= maxLength) {
    return value
  }
  let end = maxLength - 1
  const lead = value.charCodeAt(end - 1)
  if (lead >= 0xd800 && lead <= 0xdbff) {
    end -= 1
  }
  return `${value.slice(0, end)}…`
}

const signedFloatTemplate = (template: string, items: readonly EachValue[]): string => {
  let signed = template
  const occurrences = signed.match(/%f/g) ?? []
  for (const at of occurrences.keys()) {
    const value = items[at]
    const negativeNaN = isNegativeNaN(value)
    if (!negativeNaN && !isNegativeZero(value)) {
      continue
    }
    let occurrence = 0
    signed = signed.replace(/%f/g, (match) => {
      occurrence += 1
      return occurrence === at + 1 ? `-${match}` : match
    })
  }
  return signed
}

const escapedPercentTailOf = (value: EachValue, formatValue: EachValueFormatter): string =>
  value !== null && typeof value === 'object'
    ? ` ${formatValue(value)}`
    : ` ${typeof value === 'symbol' ? value.toString() : String(value)}`

interface StringCoercibleObject {
  readonly toString: () => string
}

const isStringCoercibleObject = (value: unknown): value is StringCoercibleObject =>
  value !== null &&
  typeof value === 'object' &&
  (Symbol.toPrimitive in value ||
    typeof Reflect.get(value, 'toString') === 'function' ||
    typeof Reflect.get(value, 'valueOf') === 'function')

const numericTextOf = (value: EachValue): string => {
  if (typeof value === 'string') {
    return value
  }
  if (
    typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint' || typeof value === 'undefined'
  ) {
    return String(value)
  }
  if (value === null) {
    return 'null'
  }
  if (typeof value === 'symbol') {
    return value.toString()
  }
  if (isStringCoercibleObject(value)) {
    const coercible: StringCoercibleObject = value
    return String(coercible)
  }
  throw new TypeError('Cannot convert object to primitive value')
}

const formatTokenPair = (
  token: string,
  value: EachValue,
  formatValue: EachValueFormatter,
): string => {
  switch (token) {
    case '%%':
      return `%${escapedPercentTailOf(value, formatValue)}`
    case '%s': {
      if (typeof value === 'bigint') {
        return `${value.toString()}n`
      }
      if (isNegativeZero(value)) {
        return '-0'
      }
      if (value !== null && typeof value === 'object') {
        if (typeof value.toString === 'function' && value.toString !== Object.prototype.toString) {
          const custom = value as { toString: () => string }
          return custom.toString()
        }
        return formatValue(value)
      }
      return String(value)
    }
    case '%d': {
      if (typeof value === 'bigint') {
        return `${value}n`
      }
      if (typeof value === 'symbol') {
        return 'NaN'
      }
      return Number(value).toString()
    }
    case '%i': {
      if (typeof value === 'bigint') {
        return `${value.toString()}n`
      }
      return Number.parseInt(numericTextOf(value)).toString()
    }
    case '%f':
      return Number.parseFloat(numericTextOf(value)).toString()
    case '%o':
    case '%O':
      return formatValue(value)
    case '%c':
      return ''
    case '%j': {
      try {
        return String(JSON.stringify(value))
      } catch (error) {
        const message = error instanceof Error ? error.message : ''
        if (message.includes('circular structure') || message.includes('cyclic')) {
          return '[Circular]'
        }
        throw error
      }
    }
    default:
      return token
  }
}

const substituteAttributes = (
  segment: string,
  items: readonly EachValue[],
  formatValue: EachValueFormatter,
  truncate: number,
): string =>
  segment.replace(ATTRIBUTE_TOKENS, (match, key: string) => {
    const isArrayKey = /^\d+$/.test(key)
    const isObjectItem = isObjectValue(items[0])
    if (!isObjectItem && !isArrayKey) {
      return match
    }
    const arrayElement = isArrayKey ? objectAttr(items, key, undefined) : undefined
    const value = isObjectItem ? objectAttr(items[0], key, arrayElement) : arrayElement
    if (typeof value === 'string') {
      return truncateString(value, truncate)
    }
    return formatValue(value)
  })

export const formatEachName = (
  template: string,
  row: EachValue,
  options?: EachNameOptions,
): string => {
  const index = options?.index ?? 0
  const truncate = options?.truncate ?? DEFAULT_TITLE_VALUE_FORMAT_TRUNCATE
  const formatValue = options?.formatValue ?? ((value) => defaultFormatValue(value, truncate))
  const items: readonly EachValue[] = Array.isArray(row) ? row : [row]

  const indexed = template.includes('%#') || template.includes('%$')
    ? template
      .replace(/%%/g, ESCAPED_PERCENT)
      .replace(/%#/g, String(index))
      .replace(/%\$/g, String(index + 1))
      .replace(new RegExp(ESCAPED_PERCENT, 'g'), '%%')
    : template

  const count = indexed.split('%').length - 1
  const withSigns = indexed.includes('%f') ? signedFloatTemplate(indexed, items) : indexed
  let cursor = 0
  const next = (): EachValue => {
    const value = items[cursor]
    cursor += 1
    return value
  }

  let output = ''
  let lastIndex = 0
  for (const match of withSigns.matchAll(FORMAT_TOKENS)) {
    const at = match.index
    if (lastIndex < at) {
      output += substituteAttributes(withSigns.slice(lastIndex, at), items, formatValue, truncate)
    }
    const token = match[0]
    output += cursor < count ? formatTokenPair(token, next(), formatValue) : token
    lastIndex = at + token.length
  }
  if (lastIndex < withSigns.length) {
    output += substituteAttributes(withSigns.slice(lastIndex), items, formatValue, truncate)
  }
  return output
}
