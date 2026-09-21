import { formatEachName } from './each-name.js'

export type TestMode = 'run' | 'skip' | 'only' | 'todo'

export interface RegistryTaskInfo {
  readonly type: 'test'
  readonly name: string
}

export interface HarnessTestContext {
  readonly signal: AbortSignal
  readonly task: RegistryTaskInfo
  readonly onTestFinished: (finalizer: (context: HarnessTestContext) => unknown) => void
}

export type HarnessTestFunction = (context: HarnessTestContext) => unknown

export interface RegisteredTest {
  readonly type: 'test'
  readonly seq: number
  readonly name: string
  readonly file: string
  readonly suiteIds: readonly number[]
  readonly mode: TestMode
  readonly inverted: boolean
  readonly fn: HarnessTestFunction | undefined
}

export interface RegisteredSuite {
  readonly id: number
  readonly name: string
  readonly parentIds: readonly number[]
  readonly mode: TestMode
}

export type HookKind = 'beforeAll' | 'afterAll' | 'beforeEach' | 'afterEach'

export type HookSets = Record<HookKind, Array<(context: HarnessTestContext) => unknown>>

const emptyHookSets = (): HookSets => ({
  beforeAll: [],
  afterAll: [],
  beforeEach: [],
  afterEach: [],
})

export interface TestRegistry {
  readonly suites: Map<number, RegisteredSuite>
  readonly tests: RegisteredTest[]
  readonly rootHooks: HookSets
  readonly suiteHooks: Map<number, HookSets>
  readonly frames: { current: readonly number[] }
  readonly files: { current: string }
  currentTest: HarnessTestContext | undefined
  registerSuite(name: string, parentIds: readonly number[], mode: TestMode): RegisteredSuite
  registerTest(
    name: string,
    suiteIds: readonly number[],
    mode: TestMode,
    inverted: boolean,
    fn: HarnessTestFunction | undefined,
  ): RegisteredTest
}

export const createRegistry = (): TestRegistry => {
  const suites = new Map<number, RegisteredSuite>()
  const suiteHooks = new Map<number, HookSets>()
  const tests: RegisteredTest[] = []
  const files = { current: '' }
  let seq = 0
  let suiteSeq = 0

  return {
    suites,
    tests,
    rootHooks: emptyHookSets(),
    suiteHooks,
    frames: { current: [] },
    files,
    currentTest: undefined,
    registerSuite: (name, parentIds, mode) => {
      const suite: RegisteredSuite = { id: ++suiteSeq, name, parentIds, mode }
      suites.set(suite.id, suite)
      suiteHooks.set(suite.id, emptyHookSets())
      return suite
    },
    registerTest: (name, suiteIds, mode, inverted, fn) => {
      const test: RegisteredTest = { type: 'test', seq: ++seq, name, file: files.current, suiteIds, mode, inverted, fn }
      tests.push(test)
      return test
    },
  }
}

export interface HookApi {
  readonly beforeAll: (hook: (context: HarnessTestContext) => unknown) => void
  readonly afterAll: (hook: (context: HarnessTestContext) => unknown) => void
  readonly beforeEach: (hook: (context: HarnessTestContext) => unknown) => void
  readonly afterEach: (hook: (context: HarnessTestContext) => unknown) => void
  readonly onTestFinished: (finalizer: (context: HarnessTestContext) => unknown) => void
}

export type TestFunctionWithTimeout = (context: HarnessTestContext) => unknown

export interface VariantApi {
  (name: string, fn: TestFunctionWithTimeout, timeout?: number): void
  (name: string, options: { readonly timeout?: number }, fn: TestFunctionWithTimeout): void
  readonly each: EachApi
  readonly for: EachApi
}

export interface RegistryTestApi {
  (name: string, fn: TestFunctionWithTimeout, timeout?: number): void
  (name: string, options: { readonly timeout?: number }, fn: TestFunctionWithTimeout): void
  readonly skip: VariantApi
  readonly only: VariantApi
  readonly fails: VariantApi
  readonly todo: (name: string) => void
  readonly each: EachApi
  readonly for: EachApi
}

export interface EachApi {
  (cases: readonly unknown[], name?: string, fn?: EachFn): void | ((name: string, fn: EachFn) => void)
}

export type EachFn = (args: unknown, context: HarnessTestContext) => unknown

export interface SuiteVariants {
  (name: string, body: SuiteBody): void
  readonly each: SuiteEachApi
  readonly for: SuiteEachApi
}

export interface RegistrySuiteApi {
  (name: string, body: SuiteBody): void
  readonly skip: SuiteVariants
  readonly only: SuiteVariants
  readonly todo: (name: string) => void
  readonly each: SuiteEachApi
  readonly for: SuiteEachApi
}

export interface SuiteEachApi {
  (cases: readonly unknown[], name?: string, body?: EachSuiteBody): void | ((name: string, body: EachSuiteBody) => void)
}

export type SuiteBody = (api: RegistryTestApi) => void
export type EachSuiteBody = (args: unknown, api: RegistryTestApi) => void

export interface HarnessApi {
  readonly describe: RegistrySuiteApi
  readonly suite: RegistrySuiteApi
  readonly it: RegistryTestApi
  readonly test: RegistryTestApi
  readonly hooks: HookApi
}

const rowsOf = (cases: readonly unknown[]): ReadonlyArray<unknown> =>
  cases.map((row) => (Array.isArray(row) ? (row[0] as unknown) : row))
const resolveFn = (fnOrOptions: unknown, maybeFn: unknown): HarnessTestFunction | undefined =>
  typeof fnOrOptions === 'function'
    ? (fnOrOptions as HarnessTestFunction)
    : (maybeFn as HarnessTestFunction | undefined)

const registerVariants = (registry: TestRegistry, mode: TestMode, inverted: boolean): VariantApi => {
  const at = () => registry.frames.current
  const bindEach = (cases: readonly unknown[]) => (name: string, fn: EachFn) => {
    for (const row of rowsOf(cases)) {
      registry.registerTest(formatEachName(name, row), at(), mode, inverted, (context) => fn(row, context))
    }
  }
  const each: EachApi = (cases: readonly unknown[], name?: string, fn?: EachFn) =>
    name === undefined || fn === undefined ? bindEach(cases) : bindEach(cases)(name, fn)
  return Object.assign(
    (name: string, fnOrOptions?: unknown, maybeFn?: unknown) => {
      registry.registerTest(name, at(), mode, inverted, resolveFn(fnOrOptions, maybeFn))
    },
    { each, for: each },
  )
}

const createIt = (registry: TestRegistry): RegistryTestApi => {
  const each = registerVariants(registry, 'run', false).each
  return Object.assign(
    (name: string, fnOrOptions?: unknown, maybeFn?: unknown) => {
      registry.registerTest(name, registry.frames.current, 'run', false, resolveFn(fnOrOptions, maybeFn))
    },
    {
      skip: registerVariants(registry, 'skip', false),
      only: registerVariants(registry, 'only', false),
      fails: registerVariants(registry, 'run', true),
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
    const bindEach = (cases: readonly unknown[]) => (name: string, body: EachSuiteBody) => {
      for (const row of rowsOf(cases)) {
        open(formatEachName(name, row), mode, (api) => body(row, api))
      }
    }
    const each: SuiteEachApi = (cases: readonly unknown[], name?: string, body?: EachSuiteBody) =>
      name === undefined || body === undefined ? bindEach(cases) : bindEach(cases)(name, body)
    return Object.assign((name: string, body: SuiteBody) => open(name, mode, body), {
      each,
      for: each,
    })
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

const hookAt = (registry: TestRegistry, kind: HookKind, hook: (context: HarnessTestContext) => unknown): void => {
  const ids = registry.frames.current
  const innermost = ids[ids.length - 1]
  const target = innermost === undefined ? registry.rootHooks : registry.suiteHooks.get(innermost)
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
      onTestFinished: (finalizer) => {
        const current = registry.currentTest
        if (current === undefined) {
          throw new Error('onTestFinished must be called while a test is running')
        }
        current.onTestFinished(finalizer)
      },
    },
  }
}

export const fullNameOf = (registry: TestRegistry, test: RegisteredTest): string =>
  [...test.suiteIds.map((id) => registry.suites.get(id)?.name ?? ''), test.name].join(' > ')

const containsOnly = (registry: TestRegistry): boolean =>
  registry.tests.some((test) => test.mode === 'only') ||
  [...registry.suites.values()].some((suite) => suite.mode === 'only')

const isSkipped = (registry: TestRegistry, test: RegisteredTest, onlyPresent: boolean): boolean => {
  if (test.mode === 'skip' || test.mode === 'todo') {
    return true
  }
  const suitesInPath = test.suiteIds.map((id) => registry.suites.get(id))
  if (suitesInPath.some((suite) => suite?.mode === 'skip' || suite?.mode === 'todo')) {
    return true
  }
  const onlyInPath = test.mode === 'only' || suitesInPath.some((suite) => suite?.mode === 'only')
  return onlyPresent && !onlyInPath
}

export interface PlannedTest {
  readonly test: RegisteredTest
  readonly fullName: string
  readonly chain: readonly number[]
  readonly skipped: boolean
  readonly index: number
}

export const planRun = (registry: TestRegistry): ReadonlyArray<PlannedTest> => {
  const onlyPresent = containsOnly(registry)
  const nameCounts = new Map<string, number>()
  return registry.tests.map((test, index) => {
    const fullName = fullNameOf(registry, test)
    const seen = nameCounts.get(fullName) ?? 0
    nameCounts.set(fullName, seen + 1)
    return {
      test,
      fullName: seen === 0 ? fullName : `${fullName} [${seen}]`,
      chain: test.suiteIds,
      skipped: isSkipped(registry, test, onlyPresent),
      index,
    }
  })
}

export const hooksFor = (
  registry: TestRegistry,
  kind: HookKind,
  chain: readonly number[],
): ReadonlyArray<(context: HarnessTestContext) => unknown> => [
  ...registry.rootHooks[kind],
  ...chain.flatMap((id) => registry.suiteHooks.get(id)?.[kind] ?? []),
]

export { formatEachName }
