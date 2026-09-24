import * as Match from 'effect/Match'
import * as Option from 'effect/Option'

import { STATE_KEY } from './harness-sources.handle.js'
import type {
  AroundKind,
  AroundRegistration,
  AroundSets,
  BenchOptionsInput,
  BenchRegistrationLike,
  HarnessTestContext,
  HarnessTestFunction,
  HookKind,
  HookSets,
  PlannedTest,
  PlanRunOptions,
  RegisteredHook,
  RegisteredSuite,
  RegisteredTest,
  RunnerFile,
  RunnerSuite,
  RunnerTaskResult,
  RunnerTest,
  SuiteRegistration,
  TagDeclaration,
  TagPolicy,
  TestContext,
  TestRegistry,
  VmExpectState,
} from './registry.schema.js'

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

const emptyHookSets = (): HookSets => ({
  beforeAll: [],
  afterAll: [],
  beforeEach: [],
  afterEach: [],
})

const emptyAroundSets = (): AroundSets => ({ aroundEach: [], aroundAll: [] })

export const PENDING_TAG = Symbol.for('@systemfsoftware/stryker-vm-harness/PendingError')

export const pendingErrorOf = (note: string | undefined): Error => {
  const error = new Error(note ?? 'test is skipped; abort execution')
  Object.defineProperty(error, PENDING_TAG, { value: true, enumerable: false })
  return error
}

export const isPendingError = <A = unknown>(cause: A): boolean =>
  typeof cause === 'object' && cause !== null && PENDING_TAG in cause

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

export const tagsForChain = (
  registry: TestRegistry,
  chain: ReadonlyArray<number>,
  own: ReadonlyArray<string> | undefined,
): ReadonlyArray<string> | undefined => {
  const inherited = chain.flatMap((id) => registry.suites.get(id)?.tags ?? [])
  const merged = [...inherited, ...(own ?? [])]
  return merged.length === 0 ? undefined : merged
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

export const fullNameOf = (registry: TestRegistry, test: RegisteredTest): string =>
  [...test.suiteIds.map((id) => registry.suites.get(id)?.name ?? ''), test.name].join(' > ')

const containsOnlyInFile = (registry: TestRegistry, file: string): boolean =>
  registry.tests.some((test) => test.file === file && test.mode === 'only') ||
  [...registry.suites.values()].some((suite) => suite.view.file.filepath === file && suite.mode === 'only')

export const ONLY_REFUSAL_MESSAGE =
  '[Vitest] Unexpected .only modifier. Remove it or pass --allowOnly argument to bypass this error'

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
