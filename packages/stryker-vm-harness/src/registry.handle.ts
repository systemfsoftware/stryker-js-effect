import { dual } from 'effect/Function'
import * as Option from 'effect/Option'

import { STATE_KEY } from './harness-sources.handle.js'
import type {
  AroundKind,
  AroundRegistration,
  AroundSets,
  BenchFactoryLike,
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
  TestMode,
  TestRegistration,
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

const isObjectLike = <A = unknown>(value: A): value is A & object => typeof value === 'object' && value !== null

export const isPendingError = <A = unknown>(cause: A): boolean => isObjectLike(cause) && PENDING_TAG in cause

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

type ExpectFactory = NonNullable<VmExpectState['expect']>

const isVmExpectState = (value: unknown): value is VmExpectState =>
  typeof value === 'object' ? value !== null : typeof value === 'function'

const asVmExpectState = <A = unknown>(value: A): VmExpectState | undefined => isVmExpectState(value) ? value : undefined

const vmExpectStateOf = (): VmExpectState | undefined => asVmExpectState(Reflect.get(globalThis, STATE_KEY))

const expectFactoryIn = (state: VmExpectState | undefined): VmExpectState['expect'] => state?.expect

const benchFactoryIn = (state: VmExpectState | undefined): BenchFactoryLike | undefined => state?.bench

const missingExpect = (): never => {
  throw new Error('context.expect is unavailable outside a running vm session')
}

const missingBench = (): never => {
  throw new Error('context.bench is unavailable outside a running vm session')
}

const requireExpectFactory = (): ExpectFactory => {
  const factory = expectFactoryIn(vmExpectStateOf())
  return typeof factory === 'function' ? factory : missingExpect()
}

const requireBenchFactory = (): BenchFactoryLike => {
  const factory = benchFactoryIn(vmExpectStateOf())
  return typeof factory === 'function' ? factory : missingBench()
}

const benchWithFunction = (
  state: BenchFactoryLike,
  name: string | Function,
  fn: (...args: ReadonlyArray<never>) => void | Promise<void>,
  timeout: (() => void | Promise<void>) | undefined,
): BenchRegistrationLike<string> => timeout === undefined ? state(name, fn) : state(name, {}, fn)

const benchWithOptions = (
  state: BenchFactoryLike,
  name: string | Function,
  options: Record<string, string | number | boolean | null | undefined>,
  fn: (() => void | Promise<void>) | undefined,
): BenchRegistrationLike<string> => state(name, options, fn ?? (() => undefined))

const joinedName = (prefix: string | undefined, name: string): string =>
  [prefix, name].filter((part) => part !== undefined).join(' > ')

const suiteViewOf = (suites: Map<number, RegisteredSuite>, parentIds: readonly number[]): RunnerSuite | undefined =>
  Option.getOrUndefined(
    Option.flatMap(Option.fromNullishOr(parentIds.at(-1)), (id) => Option.fromNullishOr(suites.get(id)?.view)),
  )

const suiteNamesOf = (
  parentSuite: RunnerSuite | undefined,
  name: string,
): { readonly fullName: string; readonly fullTestName: string } =>
  parentSuite === undefined
    ? { fullName: name, fullTestName: name }
    : {
      fullName: joinedName(parentSuite.fullName, name),
      fullTestName: joinedName(parentSuite.fullTestName, name),
    }

const testFullNameOf = (suiteView: RunnerSuite | undefined, name: string): string =>
  joinedName(suiteView?.fullTestName, name)

const attachSuiteView = (file: RunnerFile, parentSuite: RunnerSuite | undefined, view: RunnerSuite): void => {
  if (parentSuite === undefined) {
    file.tasks.push(view)
  }
}

const attachTestTask = (suiteView: RunnerSuite | undefined, fileView: RunnerFile, task: RunnerTest): void => {
  if (suiteView !== undefined) {
    suiteView.tasks.push(task)
  }
  fileView.tasks.push(task)
}

const draftFileViewOf = (file: string): Omit<RunnerFile, 'file'> => ({
  type: 'suite',
  id: `file:${file}`,
  name: file,
  fullName: file,
  filepath: file,
  mode: 'run',
  tasks: [],
  result: undefined,
})

const missingSelfFile = (): never => {
  throw new Error('a runner file view must reference its own file')
}

const isSelfFileView = (view: Omit<RunnerFile, 'file'>): view is RunnerFile => 'file' in view

const selfFileViewOf = (draft: Omit<RunnerFile, 'file'>): RunnerFile => {
  Reflect.set(draft, 'file', draft)
  return isSelfFileView(draft) ? draft : missingSelfFile()
}

const EMPTY_TEST_REGISTRATION: TestRegistration = {
  timeout: undefined,
  retry: undefined,
  repeats: undefined,
  concurrent: false,
  each: false,
  tags: undefined,
  fixtures: undefined,
}

interface RunnerTestDraft extends Omit<RunnerTest, 'context'> {
  context?: HarnessTestContext | undefined
}

function assertCompleteTask(_draft: RunnerTestDraft): asserts _draft is RunnerTest {}

const completeTaskOf = (draft: RunnerTestDraft): RunnerTest => {
  assertCompleteTask(draft)
  return draft
}

export const createRegistry = (): TestRegistry => {
  const suites = new Map<number, RegisteredSuite>()
  const tests: RegisteredTest[] = []
  const rootHooks = new Map<string, HookSets>()
  const suiteHooks = new Map<number, HookSets>()
  const rootAround = new Map<string, AroundSets>()
  const suiteAround = new Map<number, AroundSets>()
  const fileViews = new Map<string, RunnerFile>()
  const frames: { current: readonly number[] } = { current: [] }
  const files = { current: '' }
  const provided: { current: Record<string, object | string | number | boolean | null | undefined> } = { current: {} }
  let currentTest: HarnessTestContext | undefined
  let seq = 0
  let suiteSeq = 0
  let orderSeq = 0
  const fileViewFor = (file: string): RunnerFile => {
    const existing = fileViews.get(file)
    if (existing !== undefined) {
      return existing
    }
    const view = selfFileViewOf(draftFileViewOf(file))
    fileViews.set(file, view)
    return view
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
      const parentSuite = suiteViewOf(suites, parentIds)
      const file = fileViewFor(files.current)
      const names = suiteNamesOf(parentSuite, name)
      const view: RunnerSuite = {
        type: 'suite',
        id: `suite:${suiteSeq}`,
        name,
        fullName: names.fullName,
        fullTestName: names.fullTestName,
        suite: parentSuite,
        file,
        mode,
        tasks: [],
        result: undefined,
      }
      attachSuiteView(file, parentSuite, view)
      const suite: RegisteredSuite = {
        id: suiteSeq,
        order: orderSeq += 1,
        name,
        parentIds,
        mode,
        concurrent: registration.concurrent === true,
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
      const suiteView = suiteViewOf(suites, suiteIds)
      const options = registration ?? EMPTY_TEST_REGISTRATION
      const fullName = testFullNameOf(suiteView, name)
      const task = completeTaskOf({
        type: 'test',
        id: `${file}#${fullName}`,
        name,
        fullName,
        fullTestName: fullName,
        suite: suiteView,
        file: fileView,
        mode,
        each: options.each === true,
        fails: inverted,
        concurrent: options.concurrent === true,
        shuffle: options.shuffle,
        timeout: options.timeout,
        retry: options.retry,
        repeats: options.repeats,
        tags: options.tags,
        result: undefined,
        context: undefined,
        onFailed: undefined,
        onFinished: undefined,
        annotations: [],
        meta: {},
        promises: undefined,
      })
      task.context = createTestContext(task)
      attachTestTask(suiteView, fileView, task)
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
        timeout: options.timeout,
        retry: options.retry,
        repeats: options.repeats,
        concurrent: options.concurrent === true,
        each: options.each === true,
        tags: options.tags,
        fixtures: options.fixtures,
        fixtureNames: options.fixtureNames,
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
  const markSkipped = (): void => {
    const result = task.result ?? runnerResultOf()
    result.pending = true
    task.result = result
  }
  const skipNoteOf = (condition: boolean | string | undefined, note: string | undefined): string | undefined =>
    typeof condition === 'string' ? condition : note
  const skippedErrorOf = (condition: boolean | string | undefined, note: string | undefined): Error => {
    markSkipped()
    return pendingErrorOf(skipNoteOf(condition, note))
  }
  return Object.assign(callable, {
    get signal(): AbortSignal {
      return controllerOf(callable).signal
    },
    task,
    expect: <T = unknown>(value: T, message?: string): object => requireExpectFactory()(value, message),
    bench: (
      name: string | Function,
      fnOrOptions: BenchOptionsInput,
      fn?: () => void | Promise<void>,
    ): BenchRegistrationLike<string> => {
      const state = requireBenchFactory()
      return typeof fnOrOptions === 'function'
        ? benchWithFunction(state, name, fnOrOptions, fn)
        : benchWithOptions(state, name, fnOrOptions, fn)
    },
    skip: (condition?: boolean | string, note?: string): void => {
      if (condition === false) {
        return
      }
      throw skippedErrorOf(condition, note)
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

const orEmpty = <A>(values: ReadonlyArray<A> | undefined): ReadonlyArray<A> => values ?? []

const suiteTagsOf = (registry: TestRegistry, chain: ReadonlyArray<number>): ReadonlyArray<string> =>
  chain.flatMap((id) => orEmpty(registry.suites.get(id)?.tags))

const mergedTagsOf = (
  inherited: ReadonlyArray<string>,
  own: ReadonlyArray<string> | undefined,
): ReadonlyArray<string> | undefined => {
  const merged = [...inherited, ...orEmpty(own)]
  return merged.length === 0 ? undefined : merged
}

export const tagsForChain = dual<
  (
    chain: ReadonlyArray<number>,
    own: ReadonlyArray<string> | undefined,
  ) => (registry: TestRegistry) => ReadonlyArray<string> | undefined,
  (
    registry: TestRegistry,
    chain: ReadonlyArray<number>,
    own: ReadonlyArray<string> | undefined,
  ) => ReadonlyArray<string> | undefined
>(3, (registry, chain, own) => mergedTagsOf(suiteTagsOf(registry, chain), own))

export const undeclaredTagMessage = dual<
  (declared: ReadonlyArray<TagDeclaration>) => (tag: string) => string,
  (tag: string, declared: ReadonlyArray<TagDeclaration>) => string
>(2, (tag, declared) => {
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
})

const declaredTagsOf = (policy: TagPolicy): ReadonlyArray<TagDeclaration> => policy.tags ?? []

const testsForFile = (registry: TestRegistry, file: string): ReadonlyArray<RegisteredTest> =>
  registry.tests.filter((test) => test.file === file)

const suitesForFile = (registry: TestRegistry, file: string): ReadonlyArray<RegisteredSuite> =>
  [...registry.suites.values()].filter((suite) => suite.view.file.filepath === file)

const tagListsForFile = (registry: TestRegistry, file: string): ReadonlyArray<ReadonlyArray<string> | undefined> => [
  ...testsForFile(registry, file).map((test) => test.tags),
  ...suitesForFile(registry, file).map((suite) => suite.tags),
]

const firstUndeclaredTag = (
  tags: ReadonlyArray<string> | undefined,
  declaredNames: ReadonlySet<string>,
): string | undefined => tags?.find((tag) => !declaredNames.has(tag))

const checkTagsOf = (
  tags: ReadonlyArray<string> | undefined,
  declaredNames: ReadonlySet<string>,
  declared: ReadonlyArray<TagDeclaration>,
): void => {
  const offending = firstUndeclaredTag(tags, declaredNames)
  if (offending !== undefined) {
    throw new Error(undeclaredTagMessage(offending, declared))
  }
}

const validateTagLists = (
  tagLists: ReadonlyArray<ReadonlyArray<string> | undefined>,
  declaredNames: ReadonlySet<string>,
  declared: ReadonlyArray<TagDeclaration>,
): void => {
  for (const tags of tagLists) {
    checkTagsOf(tags, declaredNames, declared)
  }
}

const failureMessageOf = <A>(cause: A): string =>
  cause instanceof Error ? cause.message : new Error('tag validation failed', { cause }).message

const validateDeclaredTags = (registry: TestRegistry, file: string, policy: TagPolicy): void => {
  const declared = declaredTagsOf(policy)
  const declaredNames = new Set(declared.map((definition) => definition.name))
  try {
    validateTagLists(tagListsForFile(registry, file), declaredNames, declared)
  } catch (error) {
    registry.collectFailures.set(file, failureMessageOf(error))
  }
}

export const validateTagsForFile = dual<
  (file: string, policy: TagPolicy) => (registry: TestRegistry) => void,
  (registry: TestRegistry, file: string, policy: TagPolicy) => void
>(3, (registry, file, policy) => {
  if (policy.strictTags === false) {
    return
  }
  validateDeclaredTags(registry, file, policy)
})

const textOrEmpty = (value: string | undefined): string => value ?? ''

const suiteNameAt = (registry: TestRegistry, id: number): string => textOrEmpty(registry.suites.get(id)?.name)

export const fullNameOf = dual<
  (test: RegisteredTest) => (registry: TestRegistry) => string,
  (registry: TestRegistry, test: RegisteredTest) => string
>(2, (registry, test) => [...test.suiteIds.map((id) => suiteNameAt(registry, id)), test.name].join(' > '))

const containsOnlyInFile = (registry: TestRegistry, file: string): boolean =>
  registry.tests.some((test) => test.file === file && test.mode === 'only') ||
  [...registry.suites.values()].some((suite) => suite.view.file.filepath === file && suite.mode === 'only')

export const ONLY_REFUSAL_MESSAGE =
  '[Vitest] Unexpected .only modifier. Remove it or pass --allowOnly argument to bypass this error'

const isOnlyMarked = (registry: TestRegistry, test: RegisteredTest): boolean =>
  test.mode === 'only' || test.suiteIds.some((id) => suiteModeOf(registry, id) === 'only')

const suiteModeOf = (registry: TestRegistry, id: number): TestMode | undefined => registry.suites.get(id)?.mode

const isPendingMode = (mode: TestMode | undefined): boolean => mode === 'skip' || mode === 'todo'

const isExplicitlySkipped = (test: RegisteredTest): boolean => isPendingMode(test.mode)

const isSuiteSkipped = (registry: TestRegistry, test: RegisteredTest): boolean =>
  test.suiteIds.some((id) => isPendingMode(suiteModeOf(registry, id)))

const isModeSkipped = (registry: TestRegistry, test: RegisteredTest): boolean =>
  isExplicitlySkipped(test) || isSuiteSkipped(registry, test)

const onlySkippedOf = (registry: TestRegistry, test: RegisteredTest, allowOnly: boolean): boolean =>
  allowOnly ? !isOnlyMarked(registry, test) : true

const skippedWhenOnly = (
  registry: TestRegistry,
  test: RegisteredTest,
  onlyPresent: boolean,
  allowOnly: boolean,
): boolean => (onlyPresent ? onlySkippedOf(registry, test, allowOnly) : false)

const isSkipped = (
  registry: TestRegistry,
  test: RegisteredTest,
  onlyPresent: boolean,
  allowOnly: boolean,
): boolean => isModeSkipped(registry, test) || skippedWhenOnly(registry, test, onlyPresent, allowOnly)

const allowOnlyForOf = (options: PlanRunOptions | undefined): PlanRunOptions['allowOnlyFor'] => options?.allowOnlyFor

const allowOnlyForFileOf = (options: PlanRunOptions | undefined, file: string): boolean | undefined =>
  allowOnlyForOf(options)?.(file)

const allowOnlyDefaultOf = (options: PlanRunOptions | undefined): boolean | undefined => options?.allowOnly

const firstDefinedOf = <A>(first: A | undefined, second: A | undefined): A | undefined => first ?? second

const allowOnlyOf = (options: PlanRunOptions | undefined, file: string): boolean =>
  firstDefinedOf(allowOnlyForFileOf(options, file), allowOnlyDefaultOf(options)) ?? true

const onlyRefused = (onlyPresent: boolean, allowOnly: boolean): boolean => onlyPresent && !allowOnly

const refusedOnlyOf = (onlyPresent: boolean, allowOnly: boolean, mode: TestMode): boolean =>
  onlyRefused(onlyPresent, allowOnly) && mode === 'only'

const distinctNameOf = (nameCounts: Map<string, number>, fullName: string): string => {
  const seen = Option.getOrElse(Option.fromNullishOr(nameCounts.get(fullName)), () => 0)
  nameCounts.set(fullName, seen + 1)
  return seen === 0 ? fullName : `${fullName} [${seen}]`
}

const planEntryOf = (
  registry: TestRegistry,
  options: PlanRunOptions | undefined,
  nameCounts: Map<string, number>,
  test: RegisteredTest,
  index: number,
): PlannedTest => {
  const onlyPresent = containsOnlyInFile(registry, test.file)
  const allowOnly = allowOnlyOf(options, test.file)
  const refused = refusedOnlyOf(onlyPresent, allowOnly, test.mode)
  return {
    test,
    fullName: distinctNameOf(nameCounts, fullNameOf(registry, test)),
    chain: test.suiteIds,
    skipped: refused ? false : isSkipped(registry, test, onlyPresent, allowOnly),
    refusedOnly: refused,
    index,
  }
}

const planOf = (registry: TestRegistry, options: PlanRunOptions | undefined): ReadonlyArray<PlannedTest> => {
  const nameCounts = new Map<string, number>()
  return registry.tests.flatMap((test, index): ReadonlyArray<PlannedTest> =>
    registry.collectFailures.has(test.file) ? [] : [planEntryOf(registry, options, nameCounts, test, index)]
  )
}

const isTestRegistryLike = <A = unknown>(value: A): boolean => isObjectLike(value) && 'registerTest' in value

const isDataFirstPlanRun = (args: IArguments): boolean => isTestRegistryLike(args[0])

export const planRun = dual<
  (options: PlanRunOptions | undefined) => (registry: TestRegistry) => ReadonlyArray<PlannedTest>,
  (registry: TestRegistry, options?: PlanRunOptions) => ReadonlyArray<PlannedTest>
>(isDataFirstPlanRun, planOf)

const hookSetOf = (sets: HookSets | undefined, kind: HookKind): Array<RegisteredHook> | undefined => sets?.[kind]

const hooksAt = (sets: HookSets | undefined, kind: HookKind): ReadonlyArray<RegisteredHook> =>
  hookSetOf(sets, kind) ?? []

const chainHooksOf = (
  byId: ReadonlyMap<number, HookSets>,
  kind: HookKind,
  chain: readonly number[],
): ReadonlyArray<RegisteredHook> => chain.flatMap((id) => hooksAt(byId.get(id), kind))

const aroundSetOf = (sets: AroundSets | undefined, kind: AroundKind): Array<AroundRegistration> | undefined =>
  sets?.[kind]

const aroundsAt = (sets: AroundSets | undefined, kind: AroundKind): ReadonlyArray<AroundRegistration> =>
  aroundSetOf(sets, kind) ?? []

const chainAroundsOf = (
  byId: ReadonlyMap<number, AroundSets>,
  kind: AroundKind,
  chain: readonly number[],
): ReadonlyArray<AroundRegistration> => chain.flatMap((id) => aroundsAt(byId.get(id), kind))

export const suiteHooksFor = dual<
  (kind: HookKind, chain: readonly number[]) => (registry: TestRegistry) => ReadonlyArray<RegisteredHook>,
  (registry: TestRegistry, kind: HookKind, chain: readonly number[]) => ReadonlyArray<RegisteredHook>
>(3, (registry, kind, chain) => chainHooksOf(registry.suiteHooks, kind, chain))

export const suiteAroundFor = dual<
  (kind: AroundKind, chain: readonly number[]) => (registry: TestRegistry) => ReadonlyArray<AroundRegistration>,
  (registry: TestRegistry, kind: AroundKind, chain: readonly number[]) => ReadonlyArray<AroundRegistration>
>(3, (registry, kind, chain) => chainAroundsOf(registry.suiteAround, kind, chain))

export const hooksFor = dual<
  (
    kind: HookKind,
    chain: readonly number[],
    file: string,
  ) => (registry: TestRegistry) => ReadonlyArray<RegisteredHook>,
  (
    registry: TestRegistry,
    kind: HookKind,
    chain: readonly number[],
    file: string,
  ) => ReadonlyArray<RegisteredHook>
>(4, (registry, kind, chain, file) => [
  ...hooksAt(registry.rootHooks.get(file), kind),
  ...suiteHooksFor(registry, kind, chain),
])

export const aroundEachHooksFor = dual<
  (
    chain: readonly number[],
    file: string,
  ) => (registry: TestRegistry) => ReadonlyArray<AroundRegistration>,
  (
    registry: TestRegistry,
    chain: readonly number[],
    file: string,
  ) => ReadonlyArray<AroundRegistration>
>(3, (registry, chain, file) => [
  ...suiteAroundFor(registry, 'aroundEach', chain),
  ...aroundsAt(registry.rootAround.get(file), 'aroundEach'),
])

export const aroundAllHooksFor = dual<
  (
    chain: readonly number[],
    file: string,
  ) => (registry: TestRegistry) => ReadonlyArray<AroundRegistration>,
  (
    registry: TestRegistry,
    chain: readonly number[],
    file: string,
  ) => ReadonlyArray<AroundRegistration>
>(3, (registry, chain, file) => [
  ...suiteAroundFor(registry, 'aroundAll', chain),
  ...aroundsAt(registry.rootAround.get(file), 'aroundAll'),
])
