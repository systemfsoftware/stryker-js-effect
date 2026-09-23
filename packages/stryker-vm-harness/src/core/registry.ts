import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import { formatEachName } from './each-name.js'

export type TestMode = 'run' | 'skip' | 'only' | 'todo'

export interface RegistryTaskInfo {
  readonly type: 'test'
  readonly name: string
}

export interface HarnessTestContext {
  readonly signal: AbortSignal
  readonly task: RegistryTaskInfo
  readonly onTestFinished: (finalizer: HarnessTestFunction) => void
}

export type HarnessTestFunction<A = unknown> = (context: HarnessTestContext) => A

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

export type HookSets = Record<HookKind, Array<HarnessTestFunction>>

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
  const tests: RegisteredTest[] = []
  const rootHooks = emptyHookSets()
  const suiteHooks = new Map<number, HookSets>()
  const frames = { current: [] as readonly number[] }
  const files = { current: '' }
  let currentTest: HarnessTestContext | undefined
  let seq = 0
  let suiteSeq = 0
  return {
    suites,
    tests,
    rootHooks,
    suiteHooks,
    frames,
    files,
    get currentTest() {
      return currentTest
    },
    set currentTest(value) {
      currentTest = value
    },
    registerSuite(name, parentIds, mode) {
      suiteSeq += 1
      const suite: RegisteredSuite = { id: suiteSeq, name, parentIds, mode }
      suites.set(suite.id, suite)
      suiteHooks.set(suite.id, emptyHookSets())
      return suite
    },
    registerTest(name, suiteIds, mode, inverted, fn) {
      seq += 1
      const test: RegisteredTest = {
        type: 'test',
        seq,
        name,
        file: files.current,
        suiteIds,
        mode,
        inverted,
        fn,
      }
      tests.push(test)
      return test
    },
  }
}

export interface HookApi {
  readonly beforeAll: (hook: HarnessTestFunction) => void
  readonly afterAll: (hook: HarnessTestFunction) => void
  readonly beforeEach: (hook: HarnessTestFunction) => void
  readonly afterEach: (hook: HarnessTestFunction) => void
  readonly onTestFinished: (finalizer: HarnessTestFunction) => void
}

export type TestFunctionWithTimeout<A = unknown> = (context: HarnessTestContext) => A

export interface TestOptions {
  readonly timeout?: number
}

export interface VariantApi {
  (name: string, fn: TestFunctionWithTimeout, timeout?: number): void
  (name: string, options: TestOptions, fn: TestFunctionWithTimeout): void
  readonly each: EachApi
  readonly for: EachApi
}

export interface RegistryTestApi {
  (name: string, fn: TestFunctionWithTimeout, timeout?: number): void
  (name: string, options: TestOptions, fn: TestFunctionWithTimeout): void
  readonly skip: VariantApi
  readonly only: VariantApi
  readonly fails: VariantApi
  readonly todo: (name: string) => void
  readonly each: EachApi
  readonly for: EachApi
}

export interface EachApi {
  <A = unknown>(cases: readonly A[], name?: string, fn?: EachFn): void | ((name: string, fn: EachFn) => void)
}

export type EachFn<A = unknown> = (...args: readonly A[]) => A

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
  <A = unknown>(
    cases: readonly A[],
    name?: string,
    body?: EachSuiteBody,
  ): void | ((name: string, body: EachSuiteBody) => void)
}

export type SuiteBody = (api: RegistryTestApi) => void
export type EachSuiteBody<A = unknown> = (...args: readonly A[]) => void

export interface HarnessApi {
  readonly describe: RegistrySuiteApi
  readonly suite: RegistrySuiteApi
  readonly it: RegistryTestApi
  readonly test: RegistryTestApi
  readonly hooks: HookApi
}

const resolveFn = (
  fnOrOptions: TestFunctionWithTimeout | TestOptions | undefined,
  maybeFn: TestFunctionWithTimeout | number | undefined,
): TestFunctionWithTimeout | undefined =>
  Match.value(typeof fnOrOptions === 'function').pipe(
    Match.when(true, () => fnOrOptions as TestFunctionWithTimeout),
    Match.when(false, () =>
      Match.value(typeof maybeFn === 'function').pipe(
        Match.when(true, () => maybeFn as TestFunctionWithTimeout),
        Match.when(false, () => undefined),
        Match.exhaustive,
      )),
    Match.exhaustive,
  )

export const createVariantApi = (registry: TestRegistry, mode: TestMode, inverted: boolean): VariantApi => {
  const at = (): readonly number[] => registry.frames.current
  const bindEach = <A = unknown>(cases: readonly A[]) => (name: string, fn: EachFn) => {
    for (const row of cases) {
      const args: readonly A[] = Array.isArray(row) ? row : [row]
      registry.registerTest(formatEachName(name, row), at(), mode, inverted, (context) => fn(...args, context))
    }
  }
  const each: EachApi = (cases, name, fn) =>
    name === undefined || fn === undefined
      ? bindEach(cases)
      : bindEach(cases)(name, fn)
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

export const createIt = (registry: TestRegistry): RegistryTestApi => {
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

export const createDescribe = (registry: TestRegistry, it: RegistryTestApi): RegistrySuiteApi => {
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
      for (const row of cases) {
        const args: readonly A[] = Array.isArray(row) ? row : [row]
        open(formatEachName(name, row), mode, (api) => body(...args, api))
      }
    }
    const each: SuiteEachApi = (cases, name, body) =>
      name === undefined || body === undefined
        ? bindEach(cases)
        : bindEach(cases)(name, body)
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

const hookAt = (registry: TestRegistry, kind: HookKind, hook: HarnessTestFunction): void => {
  const innermost = registry.frames.current.at(-1)
  const target = Option.match(Option.fromNullishOr(innermost), {
    onNone: () => registry.rootHooks,
    onSome: (id) => Option.getOrUndefined(Option.fromNullishOr(registry.suiteHooks.get(id))),
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
      onTestFinished: (finalizer) => {
        const current = Option.fromNullishOr(registry.currentTest)
        return Option.match(current, {
          onNone: () => {
            throw new Error('onTestFinished must be called while a test is running')
          },
          onSome: (c) => c.onTestFinished(finalizer),
        })
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
  const isExplicitSkip = test.mode === 'skip' || test.mode === 'todo'
  const isSuiteSkip = test.suiteIds.some((id) => {
    const mode = registry.suites.get(id)?.mode
    return mode === 'skip' || mode === 'todo'
  })
  if (isExplicitSkip || isSuiteSkip) return true
  if (!onlyPresent) return false

  const isExplicitOnly = test.mode === 'only'
  const isSuiteOnly = test.suiteIds.some((id) => registry.suites.get(id)?.mode === 'only')
  return !isExplicitOnly && !isSuiteOnly
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
    const seen = Option.getOrElse(Option.fromNullishOr(nameCounts.get(fullName)), () => 0)
    nameCounts.set(fullName, seen + 1)
    const distinctName = Match.value(seen === 0).pipe(
      Match.when(true, () => fullName),
      Match.when(false, () => `${fullName} [${seen}]`),
      Match.exhaustive,
    )
    return {
      test,
      fullName: distinctName,
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
): ReadonlyArray<HarnessTestFunction> => [
  ...registry.rootHooks[kind],
  ...chain.flatMap((id) => registry.suiteHooks.get(id)?.[kind] ?? []),
]
