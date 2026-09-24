import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'

import { type EachValue, formatEachName } from './each-name.js'
import { usedFixtureProps } from './fixture-props.js'
import {
  createFixtureRegistry,
  extendFixtures,
  type FixtureFunction,
  type FixtureHost,
  type FixtureOptions,
  type FixtureRegistry,
  type FixtureTable,
  type FixtureTableValue,
  type FixtureUse,
  type FixtureValue,
  overrideFixtures,
} from './fixtures.js'
import { STATE_KEY } from './sources.js'

export type TestMode = 'run' | 'skip' | 'only' | 'todo'

export type TaskMeta = Record<string, string | number | boolean | null | undefined>

export interface RegistryTaskInfo {
  readonly type: 'test'
  readonly name: string
  readonly meta: TaskMeta
}

export interface VmExpectState {
  readonly expect?: (<T>(actual: T, note?: string) => object) | undefined
  readonly bench?: BenchFactoryLike | undefined
}

export interface BenchRegistrationLike<Name extends string = string> {
  readonly name: Name
}

export type BenchOptionsInput =
  | Record<string, string | number | boolean | null | undefined>
  | ((...args: ReadonlyArray<never>) => void | Promise<void>)

export interface BenchFactoryLike {
  <Name extends string>(name: Name | Function, fn: () => void | Promise<void>): BenchRegistrationLike<Name>
  <Name extends string>(
    name: Name | Function,
    options: Record<string, string | number | boolean | null | undefined>,
    fn: () => void | Promise<void>,
  ): BenchRegistrationLike<Name>
}

export interface RetryTestError {
  readonly message: string
  readonly stack?: string | undefined
  readonly cause?: RetryTestError | undefined
}

export interface HarnessTestContext {
  readonly signal: AbortSignal
  readonly task: RunnerTest
  readonly onTestFinished: (finalizer: HarnessHookFunction, timeout?: number) => void
  readonly onTestFailed?: ((handler: HarnessHookFunction, timeout?: number) => void) | undefined
}

export type HarnessTestFunction<A = void> = (context: HarnessTestContext) => A

export type HarnessHookFunction = (context: HarnessTestContext) => HookCleanup | undefined | void | Promise<void>

export interface TaskError {
  readonly name: string | undefined
  readonly message: string
  readonly stack: string | undefined
}

export interface RunnerTaskResult {
  state: 'pass' | 'fail' | 'skip' | 'todo' | 'run' | undefined
  startTime: number | undefined
  duration: number | undefined
  retryCount: number | undefined
  repeatCount: number | undefined
  errors: Array<TaskError> | undefined
  note: string | undefined
  pending: boolean | undefined
}

export const runnerResultOf = (): RunnerTaskResult => ({
  state: 'run',
  startTime: undefined,
  duration: undefined,
  retryCount: undefined,
  repeatCount: undefined,
  errors: undefined,
  note: undefined,
  pending: undefined,
})

export interface RunnerFile {
  readonly type: 'suite'
  id: string
  name: string
  fullName: string
  filepath: string
  mode: TestMode
  tasks: Array<RunnerSuite | RunnerTest>
  result: RunnerTaskResult | undefined
  file: RunnerFile
}

export interface RunnerSuite {
  readonly type: 'suite'
  id: string
  name: string
  fullName: string
  fullTestName: string
  suite: RunnerSuite | undefined
  file: RunnerFile
  mode: TestMode
  tasks: Array<RunnerSuite | RunnerTest>
  result: RunnerTaskResult | undefined
}

export interface RunnerTest {
  readonly type: 'test'
  id: string
  name: string
  fullName: string
  fullTestName: string
  suite: RunnerSuite | undefined
  file: RunnerFile
  mode: TestMode
  each: boolean
  fails: boolean
  concurrent: boolean
  shuffle: boolean | undefined
  timeout: number | undefined
  retry: number | RetryOptions | undefined
  repeats: number | undefined
  tags?: ReadonlyArray<string> | undefined
  result: RunnerTaskResult | undefined
  context: HarnessTestContext
  onFailed: Array<RegisteredHook> | undefined
  onFinished: Array<RegisteredHook> | undefined
  annotations: Array<TaskAnnotation>
  meta: TaskMeta
  promises: Array<Promise<void>> | undefined
}

export interface TaskAnnotation {
  readonly message: string
  readonly type: string
}

export type HookCleanup = () => void | Promise<void>

export interface RegisteredHook {
  readonly fn: HarnessHookFunction
  readonly timeout: number | undefined
}

export interface RegisteredTest {
  readonly type: 'test'
  readonly seq: number
  readonly order: number
  readonly name: string
  readonly file: string
  readonly suiteIds: readonly number[]
  readonly mode: TestMode
  readonly inverted: boolean
  readonly fn: HarnessTestFunction | undefined
  readonly timeout: number | undefined
  readonly retry: number | RetryOptions | undefined
  readonly repeats: number | undefined
  readonly concurrent: boolean
  readonly shuffle?: boolean | undefined
  readonly each: boolean
  readonly tags?: ReadonlyArray<string> | undefined
  readonly fixtures: FixtureRegistry | undefined
  readonly fixtureNames: ReadonlySet<string> | undefined
  readonly task: RunnerTest
}

export interface RegisteredSuite {
  readonly id: number
  readonly order: number
  readonly name: string
  readonly parentIds: readonly number[]
  readonly mode: TestMode
  readonly concurrent: boolean
  readonly shuffle: boolean | undefined
  readonly timeout: number | undefined
  readonly retry: number | RetryOptions | undefined
  readonly repeats: number | undefined
  readonly tags?: ReadonlyArray<string> | undefined
  readonly view: RunnerSuite
}

export type HookKind = 'beforeAll' | 'afterAll' | 'beforeEach' | 'afterEach'

export type HookSets = Record<HookKind, Array<RegisteredHook>>

const emptyHookSets = (): HookSets => ({
  beforeAll: [],
  afterAll: [],
  beforeEach: [],
  afterEach: [],
})

export type AroundKind = 'aroundEach' | 'aroundAll'

export interface AroundRegistration {
  readonly hook: AroundHookFunction
  readonly timeout: number | undefined
}

export type AroundSets = Record<AroundKind, Array<AroundRegistration>>

const emptyAroundSets = (): AroundSets => ({ aroundEach: [], aroundAll: [] })

export const PENDING_TAG = Symbol.for('@systemfsoftware/stryker-vm-harness/PendingError')

export const pendingErrorOf = (note: string | undefined): Error => {
  const error = new Error(note ?? 'test is skipped; abort execution')
  Object.defineProperty(error, PENDING_TAG, { value: true, enumerable: false })
  return error
}

export const isPendingError = <A = unknown>(cause: A): boolean =>
  typeof cause === 'object' && cause !== null && PENDING_TAG in cause

export interface TestContext extends HarnessTestContext {
  (): never
  readonly expect: <T = unknown>(value: T, message?: string) => object
  readonly bench: BenchFactoryLike
  readonly onTestFailed: (handler: HarnessHookFunction, timeout?: number) => void
  readonly skip: (condition?: boolean | string, note?: string) => void
  readonly annotate: (message: string, type?: string) => Promise<void>
}

const controllers = new WeakMap<object, AbortController>()

export const controllerOf = (context: object): AbortController => {
  const existing = controllers.get(context)
  if (existing !== undefined) {
    return existing
  }
  const created = new AbortController()
  controllers.set(context, created)
  return created
}

export interface TestRegistration {
  readonly timeout: number | undefined
  readonly retry: number | RetryOptions | undefined
  readonly repeats: number | undefined
  readonly concurrent: boolean
  readonly shuffle?: boolean | undefined
  readonly each: boolean
  readonly tags?: ReadonlyArray<string> | undefined
  readonly fixtures: FixtureRegistry | undefined
  readonly fixtureNames?: ReadonlySet<string> | undefined
}

export interface SuiteRegistration {
  readonly concurrent?: boolean | undefined
  readonly shuffle?: boolean | undefined
  readonly timeout?: number | undefined
  readonly retry?: number | RetryOptions | undefined
  readonly repeats?: number | undefined
  readonly tags?: ReadonlyArray<string> | undefined
}

export interface TestRegistry {
  readonly suites: Map<number, RegisteredSuite>
  readonly tests: RegisteredTest[]
  readonly rootHooks: ReadonlyMap<string, HookSets>
  readonly suiteHooks: Map<number, HookSets>
  readonly rootAround: ReadonlyMap<string, AroundSets>
  readonly suiteAround: Map<number, AroundSets>
  readonly fileViews: Map<string, RunnerFile>
  readonly frames: { current: readonly number[] }
  readonly files: { current: string }
  readonly provided: { current: Record<string, object | string | number | boolean | null | undefined> }
  readonly collectFailures: Map<string, string>
  currentTest: HarnessTestContext | undefined
  rootHooksFor(file: string): HookSets
  rootAroundFor(file: string): AroundSets
  registerSuite(
    name: string,
    parentIds: readonly number[],
    mode: TestMode,
    registration?: SuiteRegistration,
  ): RegisteredSuite
  registerTest(
    name: string,
    suiteIds: readonly number[],
    mode: TestMode,
    inverted: boolean,
    fn: HarnessTestFunction | undefined,
    registration?: TestRegistration,
  ): RegisteredTest
}
export const createRegistry = (): TestRegistry => {
  const suites = new Map<number, RegisteredSuite>()
  const tests: RegisteredTest[] = []
  const rootHooks = new Map<string, HookSets>()
  const suiteHooks = new Map<number, HookSets>()
  const rootAround = new Map<string, AroundSets>()
  const suiteAround = new Map<number, AroundSets>()
  const fileViews = new Map<string, RunnerFile>()
  const frames = { current: [] as readonly number[] }
  const files = { current: '' }
  const provided = { current: {} as Record<string, object | string | number | boolean | null | undefined> }
  let currentTest: HarnessTestContext | undefined
  let seq = 0
  let suiteSeq = 0
  let orderSeq = 0
  const fileViewFor = (file: string): RunnerFile => {
    const existing = fileViews.get(file)
    if (existing !== undefined) {
      return existing
    }
    const created: RunnerFile = {
      type: 'suite',
      id: `file:${file}`,
      name: file,
      fullName: file,
      filepath: file,
      mode: 'run',
      tasks: [],
      result: undefined,
      file: undefined as never,
    }
    created.file = created
    fileViews.set(file, created)
    return created
  }

  return {
    suites,
    tests,
    rootHooks,
    suiteHooks,
    rootAround,
    suiteAround,
    fileViews,
    frames,
    files,
    provided,
    collectFailures: new Map<string, string>(),
    get currentTest() {
      return currentTest
    },
    set currentTest(value) {
      currentTest = value
    },
    rootHooksFor(file) {
      const existing = rootHooks.get(file)
      if (existing !== undefined) {
        return existing
      }
      const created = emptyHookSets()
      rootHooks.set(file, created)
      return created
    },
    rootAroundFor(file) {
      const existing = rootAround.get(file)
      if (existing !== undefined) {
        return existing
      }
      const created = emptyAroundSets()
      rootAround.set(file, created)
      return created
    },
    registerSuite(name, parentIds, mode, registration: SuiteRegistration = {}) {
      suiteSeq += 1
      const parent = parentIds.at(-1)
      const parentSuite = parent === undefined ? undefined : suites.get(parent)?.view
      const file = fileViewFor(files.current)
      const fullName = [parentSuite?.fullName, name].filter((part) => part !== undefined).join(' > ')
      const fullTestName = [parentSuite?.fullTestName, name].filter((part) => part !== undefined).join(' > ')
      const view: RunnerSuite = {
        type: 'suite',
        id: `suite:${suiteSeq}`,
        name,
        fullName,
        fullTestName,
        suite: parentSuite,
        file,
        mode,
        tasks: [],
        result: undefined,
      }
      if (parentSuite === undefined) {
        file.tasks.push(view)
      }
      const suite: RegisteredSuite = {
        id: suiteSeq,
        order: orderSeq += 1,
        name,
        parentIds,
        mode,
        concurrent: registration.concurrent ?? false,
        shuffle: registration.shuffle,
        timeout: registration.timeout,
        retry: registration.retry,
        repeats: registration.repeats,
        tags: registration.tags,
        view,
      }
      suites.set(suite.id, suite)
      suiteHooks.set(suite.id, emptyHookSets())
      suiteAround.set(suite.id, emptyAroundSets())
      return suite
    },
    registerTest(name, suiteIds, mode, inverted, fn, registration) {
      seq += 1
      const file = files.current
      const fileView = fileViewFor(file)
      const innermost = suiteIds.at(-1)
      const suiteView = innermost === undefined ? undefined : suites.get(innermost)?.view
      const fullName = [suiteView?.fullTestName, name].filter((part) => part !== undefined).join(' > ')
      const task: RunnerTest = {
        type: 'test',
        id: `${file}#${fullName}`,
        name,
        fullName,
        fullTestName: fullName,
        suite: suiteView,
        file: fileView,
        mode,
        each: registration?.each ?? false,
        fails: inverted,
        concurrent: registration?.concurrent ?? false,
        shuffle: registration?.shuffle,
        timeout: registration?.timeout,
        retry: registration?.retry,
        repeats: registration?.repeats,
        tags: registration?.tags,
        result: undefined,
        context: undefined as never,
        onFailed: undefined,
        onFinished: undefined,
        annotations: [],
        meta: {},
        promises: undefined,
      }
      task.context = createTestContext(task)
      if (suiteView !== undefined) {
        suiteView.tasks.push(task)
      }
      fileView.tasks.push(task)
      const registered: RegisteredTest = {
        type: 'test',
        seq,
        order: orderSeq += 1,
        name,
        file,
        suiteIds,
        mode,
        inverted,
        fn,
        timeout: registration?.timeout,
        retry: registration?.retry,
        repeats: registration?.repeats,
        concurrent: registration?.concurrent ?? false,
        each: registration?.each ?? false,
        tags: registration?.tags,
        fixtures: registration?.fixtures,
        fixtureNames: registration?.fixtureNames,
        task,
      }
      tests.push(registered)
      return registered
    },
  }
}
export const createTestContext = (task: RunnerTest): TestContext => {
  const callable = (): never => {
    throw new Error('done() callback is deprecated, use promise instead')
  }
  return Object.assign(callable, {
    get signal(): AbortSignal {
      return controllerOf(callable).signal
    },
    task,
    expect: <T = unknown>(value: T, message?: string): object => {
      const state = (globalThis as Record<symbol, VmExpectState | undefined>)[STATE_KEY]?.expect
      if (state === undefined || typeof state !== 'function') {
        throw new Error('context.expect is unavailable outside a running vm session')
      }
      return state(value, message)
    },
    bench: (
      name: string | Function,
      fnOrOptions: BenchOptionsInput,
      fn?: () => void | Promise<void>,
    ): BenchRegistrationLike<string> => {
      const state = (globalThis as Record<symbol, VmExpectState | undefined>)[STATE_KEY]?.bench
      if (state === undefined || typeof state !== 'function') {
        throw new Error('context.bench is unavailable outside a running vm session')
      }
      if (typeof fnOrOptions === 'function') {
        return fn === undefined ? state(name, fnOrOptions) : state(name, {}, fnOrOptions)
      }
      return state(name, fnOrOptions, fn ?? (() => undefined))
    },
    skip: (condition?: boolean | string, note?: string): void => {
      if (condition === false) {
        return
      }
      const result = task.result ?? runnerResultOf()
      result.pending = true
      task.result = result
      throw pendingErrorOf(typeof condition === 'string' ? condition : note)
    },
    onTestFailed: (handler: HarnessTestFunction, timeout?: number): void => {
      task.onFailed = [...(task.onFailed ?? []), { fn: handler, timeout }]
    },
    onTestFinished: (handler: HarnessTestFunction, timeout?: number): void => {
      task.onFinished = [...(task.onFinished ?? []), { fn: handler, timeout }]
    },
    annotate: (message: string, type = 'notice'): Promise<void> => {
      task.annotations = [...task.annotations, { message, type }]
      return Promise.resolve()
    },
  })
}

export interface HookApi {
  readonly beforeAll: (hook: HarnessHookFunction, timeout?: number) => void
  readonly afterAll: (hook: HarnessHookFunction, timeout?: number) => void
  readonly beforeEach: (hook: HarnessHookFunction, timeout?: number) => void
  readonly afterEach: (hook: HarnessHookFunction, timeout?: number) => void
  readonly aroundEach: (hook: AroundHookFunction, timeout?: number) => void
  readonly aroundAll: (hook: AroundHookFunction, timeout?: number) => void
  readonly onTestFinished: (finalizer: HarnessHookFunction, timeout?: number) => void
  readonly onTestFailed: (handler: HarnessHookFunction, timeout?: number) => void
}

export type AroundHookFunction = (
  run: () => Promise<void>,
  context: HarnessTestContext,
) => void | Promise<void>

export interface RetryOptions {
  readonly count?: number | undefined
  readonly delay?: number | undefined
  readonly condition?: RegExp | ((error: RetryTestError) => boolean) | undefined
}

export interface TestOptions {
  timeout?: number
  retry?: number | RetryOptions
  repeats?: number
  concurrent?: boolean
  fails?: boolean
  skip?: boolean
  only?: boolean
  todo?: boolean
  each?: boolean
  tags?: string | ReadonlyArray<string>
}

export interface ParsedTestArguments {
  readonly options: TestOptions
  readonly fn: HarnessTestFunction | undefined
}

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

export type TestFunctionWithTimeout<A = unknown> = (context: HarnessTestContext) => A

export interface VariantApi {
  (name: string, fn: TestFunctionWithTimeout, timeout?: number): void
  (name: string, options: TestOptions, fn: TestFunctionWithTimeout): void
  readonly each: EachApi
  readonly for: ForApi
}

export interface ChainableVariantApi extends VariantApi {
  readonly concurrent: VariantApi
  readonly skipIf: (condition: boolean) => RegistryTestApi
  readonly runIf: (condition: boolean) => RegistryTestApi
}
export type BuilderScopeName = 'test' | 'file' | 'worker'

export type BuilderFixtureOptions = FixtureOptions | BuilderScopeName

export interface BuilderExtendApi {
  (table: FixtureTable): RegistryTestApi
  (name: string, value: FixtureTableValue): RegistryTestApi
  (name: string, fn: FixtureFunction): RegistryTestApi
  (name: string, options: BuilderFixtureOptions, value: FixtureTableValue): RegistryTestApi
  (name: string, options: BuilderFixtureOptions, fn: FixtureFunction): RegistryTestApi
}
export interface BuilderScopedApi {
  (table: FixtureTable): RegistryTestApi
  (scope: 'worker' | 'file'): RegistryTestApi
  (scope: 'worker' | 'file', options: FixtureOptions): RegistryTestApi
}

export interface BuilderOverrideApi {
  (table: FixtureTable): RegistryTestApi
  (name: string, value: FixtureTableValue): RegistryTestApi
  (name: string, fn: FixtureFunction): RegistryTestApi
  (name: string, options: FixtureOptions, value: FixtureTableValue): RegistryTestApi
  (name: string, options: FixtureOptions, fn: FixtureFunction): RegistryTestApi
}
export interface RegistryTestApi extends ChainableVariantApi {
  readonly skip: VariantApi
  readonly only: VariantApi
  readonly fails: VariantApi
  readonly todo: (name: string) => void
  readonly each: EachApi
  readonly for: ForApi
  readonly extend: BuilderExtendApi & BuilderScopedApi
  readonly override: BuilderOverrideApi
  readonly scoped: BuilderOverrideApi
  readonly describe: RegistrySuiteApi
  readonly suite: RegistrySuiteApi
  readonly beforeEach: HookApi['beforeEach']
  readonly afterEach: HookApi['afterEach']
  readonly beforeAll: HookApi['beforeAll']
  readonly afterAll: HookApi['afterAll']
  readonly aroundEach: HookApi['aroundEach']
  readonly aroundAll: HookApi['aroundAll']
}
export interface EachApi {
  (cases: TemplateStringsArray, ...rows: ReadonlyArray<EachValue>): (name: string, fn: EachFn<TemplateRow>) => void
  <A>(cases: readonly A[], name?: string, fn?: EachFn<A>): void | ((name: string, fn: EachFn<A>) => void)
}
export type EachFn<A> = (...args: ReadonlyArray<A>) => EachValue
export interface ForApi {
  (cases: TemplateStringsArray, ...rows: ReadonlyArray<EachValue>): (name: string, fn: ForFn<TemplateRow>) => void
  <A>(cases: readonly A[], name?: string, fn?: ForFn<A>): void | ((name: string, fn: ForFn<A>) => void)
}
export type ForFn<A> = (row: A, context: HarnessTestContext) => EachValue
export type TemplateRow = Record<string, EachValue>

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

export const tagsForChain = (
  registry: TestRegistry,
  chain: ReadonlyArray<number>,
  own: ReadonlyArray<string> | undefined,
): ReadonlyArray<string> | undefined => {
  const inherited = chain.flatMap((id) => registry.suites.get(id)?.tags ?? [])
  const merged = [...inherited, ...(own ?? [])]
  return merged.length === 0 ? undefined : merged
}

export interface TagDeclaration {
  readonly name: string
  readonly description?: string | undefined
}

export interface TagPolicy {
  readonly tags?: ReadonlyArray<TagDeclaration> | undefined
  readonly strictTags?: boolean | undefined
}

export const undeclaredTagMessage = (
  tag: string,
  declared: ReadonlyArray<TagDeclaration>,
): string => {
  if (declared.length === 0) {
    return `The Vitest config doesn't define any "tags", cannot apply "${tag}" tag for this test. See: https://vitest.dev/guide/test-tags`
  }
  const bullets = declared
    .map((definition) =>
      definition.description === undefined
        ? `- ${definition.name}`
        : `- ${definition.name}: ${definition.description}`
    )
    .join('\n')
  return `The tag "${tag}" is not defined in the configuration. Available tags are:\n${bullets}`
}
export const validateTagsForFile = (
  registry: TestRegistry,
  file: string,
  policy: TagPolicy,
): void => {
  if (policy.strictTags === false) {
    return
  }
  const declared = policy.tags ?? []
  const declaredNames = new Set(declared.map((definition) => definition.name))
  const check = (tags: ReadonlyArray<string> | undefined): void => {
    for (const tag of tags ?? []) {
      if (!declaredNames.has(tag)) {
        throw new Error(undeclaredTagMessage(tag, declared))
      }
    }
  }
  try {
    for (const test of registry.tests) {
      if (test.file === file) {
        check(test.tags)
      }
    }
    for (const suite of registry.suites.values()) {
      if (suite.view.file.filepath === file) {
        check(suite.tags)
      }
    }
  } catch (error) {
    const message = error instanceof Error
      ? error.message
      : new Error('tag validation failed', { cause: error }).message
    registry.collectFailures.set(file, message)
  }
}

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

export interface SuiteOptions {
  readonly timeout?: number | undefined
  readonly retry?: number | undefined
  readonly repeats?: number | undefined
  readonly concurrent?: boolean | undefined
  readonly shuffle?: boolean | undefined
}

export interface SuiteVariants {
  (name: string, body: SuiteBody): void
  (name: string, options: SuiteOptions, body: SuiteBody): void
  readonly each: SuiteEachApi
  readonly for: SuiteEachApi
}

export interface RegistrySuiteApi extends SuiteVariants {
  readonly skip: SuiteVariants
  readonly only: SuiteVariants
  readonly todo: (name: string) => void
  readonly each: SuiteEachApi
  readonly for: SuiteEachApi
  readonly concurrent: SuiteVariants
  readonly shuffle: SuiteVariants
  readonly skipIf: (condition: boolean) => RegistrySuiteApi
  readonly runIf: (condition: boolean) => RegistrySuiteApi
}

export interface SuiteEachApi {
  <A = unknown>(
    cases: readonly A[],
    name?: string,
    body?: EachSuiteBody,
  ): void | ((name: string, body: EachSuiteBody) => void)
  (cases: TemplateStringsArray, ...rows: ReadonlyArray<EachValue>): (name: string, body: EachSuiteBody) => void
}

export interface SuiteForApi {
  <A = unknown>(
    cases: readonly A[],
    name?: string,
    body?: ForSuiteBody<A>,
  ): void | ((name: string, body: ForSuiteBody<A>) => void)
  (
    cases: TemplateStringsArray,
    ...rows: ReadonlyArray<EachValue>
  ): (name: string, body: ForSuiteBody<TemplateRow>) => void
}

export type SuiteBody = (api: RegistryTestApi) => void
export type EachSuiteBody<A = unknown> = (...args: readonly A[]) => EachValue
export type ForSuiteBody<A = unknown> = (row: A) => EachValue
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

export interface HarnessApi {
  readonly describe: RegistrySuiteApi
  readonly suite: RegistrySuiteApi
  readonly it: RegistryTestApi
  readonly test: RegistryTestApi
  readonly hooks: HookApi
  readonly beforeAll: HookApi['beforeAll']
  readonly afterAll: HookApi['afterAll']
  readonly beforeEach: HookApi['beforeEach']
  readonly afterEach: HookApi['afterEach']
  readonly aroundEach: HookApi['aroundEach']
  readonly aroundAll: HookApi['aroundAll']
  readonly onTestFinished: HookApi['onTestFinished']
  readonly onTestFailed: HookApi['onTestFailed']
  readonly inject: (name: string) => object | string | number | boolean | null | undefined
}

export const fullNameOf = (registry: TestRegistry, test: RegisteredTest): string =>
  [...test.suiteIds.map((id) => registry.suites.get(id)?.name ?? ''), test.name].join(' > ')

const containsOnlyInFile = (registry: TestRegistry, file: string): boolean =>
  registry.tests.some((test) => test.file === file && test.mode === 'only') ||
  [...registry.suites.values()].some((suite) => suite.view.file.filepath === file && suite.mode === 'only')

export const ONLY_REFUSAL_MESSAGE =
  '[Vitest] Unexpected .only modifier. Remove it or pass --allowOnly argument to bypass this error'

export interface PlanRunOptions {
  readonly allowOnly?: boolean | undefined
  readonly allowOnlyFor?: ((file: string) => boolean) | undefined
}

const isOnlyMarked = (registry: TestRegistry, test: RegisteredTest): boolean =>
  test.mode === 'only' || test.suiteIds.some((id) => registry.suites.get(id)?.mode === 'only')

const isSkipped = (
  registry: TestRegistry,
  test: RegisteredTest,
  onlyPresent: boolean,
  allowOnly: boolean,
): boolean => {
  const isExplicitSkip = test.mode === 'skip' || test.mode === 'todo'
  const isSuiteSkip = test.suiteIds.some((id) => {
    const mode = registry.suites.get(id)?.mode
    return mode === 'skip' || mode === 'todo'
  })
  if (isExplicitSkip || isSuiteSkip) return true
  if (!onlyPresent) return false
  if (!allowOnly) return true
  return !isOnlyMarked(registry, test)
}

export interface PlannedTest {
  readonly test: RegisteredTest
  readonly fullName: string
  readonly chain: readonly number[]
  readonly skipped: boolean
  readonly refusedOnly: boolean
  readonly index: number
}
export const planRun = (registry: TestRegistry, options?: PlanRunOptions): ReadonlyArray<PlannedTest> => {
  const nameCounts = new Map<string, number>()
  return registry.tests.flatMap((test, index) => {
    if (registry.collectFailures.has(test.file)) {
      return []
    }
    const onlyPresent = containsOnlyInFile(registry, test.file)
    const allowOnly = options?.allowOnlyFor?.(test.file) ?? options?.allowOnly ?? true
    const fullName = fullNameOf(registry, test)
    const seen = Option.getOrElse(Option.fromNullishOr(nameCounts.get(fullName)), () => 0)
    nameCounts.set(fullName, seen + 1)
    const distinctName = Match.value(seen === 0).pipe(
      Match.when(true, () => fullName),
      Match.when(false, () => `${fullName} [${seen}]`),
      Match.exhaustive,
    )
    const refused = onlyPresent && !allowOnly && test.mode === 'only'
    return [{
      test,
      fullName: distinctName,
      chain: test.suiteIds,
      skipped: refused ? false : isSkipped(registry, test, onlyPresent, allowOnly),
      refusedOnly: refused,
      index,
    }]
  })
}

export const suiteHooksFor = (
  registry: TestRegistry,
  kind: HookKind,
  chain: readonly number[],
): ReadonlyArray<RegisteredHook> => chain.flatMap((id) => registry.suiteHooks.get(id)?.[kind] ?? [])

export const suiteAroundFor = (
  registry: TestRegistry,
  kind: AroundKind,
  chain: readonly number[],
): ReadonlyArray<AroundRegistration> => chain.flatMap((id) => registry.suiteAround.get(id)?.[kind] ?? [])

export const hooksFor = (
  registry: TestRegistry,
  kind: HookKind,
  chain: readonly number[],
  file: string,
): ReadonlyArray<RegisteredHook> => [
  ...(registry.rootHooks.get(file)?.[kind] ?? []),
  ...suiteHooksFor(registry, kind, chain),
]

export const aroundEachHooksFor = (
  registry: TestRegistry,
  chain: readonly number[],
  file: string,
): ReadonlyArray<AroundRegistration> => [
  ...suiteAroundFor(registry, 'aroundEach', chain),
  ...(registry.rootAround.get(file)?.aroundEach ?? []),
]

export const aroundAllHooksFor = (
  registry: TestRegistry,
  chain: readonly number[],
  file: string,
): ReadonlyArray<AroundRegistration> => [
  ...suiteAroundFor(registry, 'aroundAll', chain),
  ...(registry.rootAround.get(file)?.aroundAll ?? []),
]
