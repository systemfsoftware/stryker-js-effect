import type { FixtureFunction, FixtureOptions, FixtureRegistry, FixtureTable, FixtureTableValue } from './fixtures.js'

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

export type AroundKind = 'aroundEach' | 'aroundAll'

export interface AroundRegistration {
  readonly hook: AroundHookFunction
  readonly timeout: number | undefined
}

export type AroundSets = Record<AroundKind, Array<AroundRegistration>>

export interface TestContext extends HarnessTestContext {
  (): never
  readonly expect: <T = unknown>(value: T, message?: string) => object
  readonly bench: BenchFactoryLike
  readonly onTestFailed: (handler: HarnessHookFunction, timeout?: number) => void
  readonly skip: (condition?: boolean | string, note?: string) => void
  readonly annotate: (message: string, type?: string) => Promise<void>
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

export interface TagDeclaration {
  readonly name: string
  readonly description?: string | undefined
}

export interface TagPolicy {
  readonly tags?: ReadonlyArray<TagDeclaration> | undefined
  readonly strictTags?: boolean | undefined
}

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

export interface PlanRunOptions {
  readonly allowOnly?: boolean | undefined
  readonly allowOnlyFor?: ((file: string) => boolean) | undefined
}

export interface PlannedTest {
  readonly test: RegisteredTest
  readonly fullName: string
  readonly chain: readonly number[]
  readonly skipped: boolean
  readonly refusedOnly: boolean
  readonly index: number
}
export type EachValue = null | undefined | string | number | boolean | bigint | symbol | object

export type EachValueFormatter = (value: EachValue) => string

export interface EachNameOptions {
  readonly index?: number | undefined
  readonly formatValue?: EachValueFormatter | undefined
  readonly truncate?: number | undefined
}
