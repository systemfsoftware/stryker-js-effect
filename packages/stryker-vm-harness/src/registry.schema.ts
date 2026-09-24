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

export interface HookApi {
  readonly beforeAll: (hook: HarnessTestFunction) => void
  readonly afterAll: (hook: HarnessTestFunction) => void
  readonly beforeEach: (hook: HarnessTestFunction) => void
  readonly afterEach: (hook: HarnessTestFunction) => void
  readonly onTestFinished: (finalizer: HarnessTestFunction) => void
}

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

export interface PlannedTest {
  readonly test: RegisteredTest
  readonly fullName: string
  readonly chain: readonly number[]
  readonly skipped: boolean
  readonly index: number
}

export type TestFunctionWithTimeout<A = unknown> = (context: HarnessTestContext) => A

export interface TestOptions {
  readonly timeout?: number
}

export type EachFn<A = unknown> = (...args: readonly A[]) => A

export interface EachApi {
  <A = unknown>(cases: readonly A[], name?: string, fn?: EachFn): void | ((name: string, fn: EachFn) => void)
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

export type SuiteBody = (api: RegistryTestApi) => void

export type EachSuiteBody<A = unknown> = (...args: readonly A[]) => void

export interface SuiteEachApi {
  <A = unknown>(
    cases: readonly A[],
    name?: string,
    body?: EachSuiteBody,
  ): void | ((name: string, body: EachSuiteBody) => void)
}

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

export interface HarnessApi {
  readonly describe: RegistrySuiteApi
  readonly suite: RegistrySuiteApi
  readonly it: RegistryTestApi
  readonly test: RegistryTestApi
  readonly hooks: HookApi
}
