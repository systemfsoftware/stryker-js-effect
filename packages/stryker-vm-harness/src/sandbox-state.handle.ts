import * as Option from 'effect/Option'
import * as Predicate from 'effect/Predicate'

import { STATE_KEY } from './harness-sources.handle.js'
import type { RunnerTest } from './registry.schema.js'
import type { VmRunnerGlobalState } from './sandbox.schema.js'
import type { VitestModuleNamespace } from './session-plugin.js'
import type { VmProjectConfig } from './vitest-config.schema.js'

type AnyDecoded<A = unknown> = A

export type { ProvidedValue } from './sandbox.schema.js'

const isGlobalState = (value: AnyDecoded): value is VmRunnerGlobalState => Predicate.isObject(value)

export const readGlobalState = (): VmRunnerGlobalState | undefined => {
  const stored: AnyDecoded = Reflect.get(globalThis, STATE_KEY)
  return Option.getOrUndefined(Option.liftPredicate(isGlobalState)(stored))
}

export const writeGlobalState = (state: VmRunnerGlobalState | undefined): void => {
  Reflect.set(globalThis, STATE_KEY, state)
}

export const globalConfigOf = (): VmProjectConfig | undefined => readGlobalState()?.projectConfig

interface ExpectStateLike {
  readonly assertionCalls: number
  readonly expectedAssertionsNumber: number | null | undefined
  readonly isExpectingAssertions: boolean | undefined
}

export interface ExpectStatePatch {
  readonly assertionCalls?: number
  readonly isExpectingAssertions?: boolean
  readonly expectedAssertionsNumber?: number | null
  readonly expectedAssertionsNumberErrorGen?: (() => Error) | null
  readonly isExpectingAssertionsError?: Error | null
  readonly currentTestName?: string
}

interface ExpectWithState {
  readonly getState: () => ExpectStateLike
  readonly setState: (state: ExpectStatePatch) => void
}

const isExpectWithState = (value: AnyDecoded): value is ExpectWithState =>
  Predicate.isObjectKeyword(value) && typeof Reflect.get(value, 'getState') === 'function'

const expectWithState = (): ExpectWithState | undefined =>
  Option.getOrUndefined(
    Option.flatMap(
      Option.fromNullishOr(readGlobalState()?.expect),
      (expect) => Option.liftPredicate(isExpectWithState)(expect),
    ),
  )

export const expectStateOf = (): ExpectStateLike | undefined => expectWithState()?.getState()

export const resetExpectStateFor = (task: RunnerTest): void => {
  const expect = expectWithState()
  if (expect === undefined) {
    return
  }
  expect.setState({
    assertionCalls: 0,
    isExpectingAssertions: false,
    expectedAssertionsNumber: null,
    currentTestName: task.fullTestName,
  })
}

export interface MockResetFlags {
  readonly restoreMocks: boolean
  readonly clearMocks: boolean
  readonly mockReset: boolean
  readonly unstubGlobals: boolean
  readonly unstubEnvs: boolean
}

const VI_RESETTER_FLAGS: Record<string, keyof MockResetFlags> = {
  restoreAllMocks: 'restoreMocks',
  resetAllMocks: 'mockReset',
  clearAllMocks: 'clearMocks',
  unstubAllEnvs: 'unstubEnvs',
  unstubAllGlobals: 'unstubGlobals',
}

export const mockResetConfigOf = (flags: MockResetFlags): void => {
  const vi = readGlobalState()?.vi
  if (vi === undefined) {
    return
  }
  for (const [method, flag] of Object.entries(VI_RESETTER_FLAGS)) {
    if (!flags[flag]) {
      continue
    }
    const reset = Reflect.get(vi, method)
    if (typeof reset === 'function') {
      Reflect.apply(reset, vi, [])
    }
  }
}

interface ExpectCallable {
  (value: object, message?: string): object
}

interface WithTestAssertion {
  readonly withTest: (task: object) => object
}

const isExpectCallable = (value: object): value is ExpectCallable => typeof value === 'function'

const isWithTestAssertion = (value: object): value is ExpectCallable & WithTestAssertion =>
  typeof Reflect.get(value, 'withTest') === 'function'

export const withRunnerTask = (expect: object, currentTask: () => object | undefined): object => {
  if (!isExpectCallable(expect)) {
    return expect
  }
  return new Proxy(expect, {
    apply(target, thisArg, args) {
      const assertion: object = Reflect.apply(target, thisArg, args)
      const task = currentTask()
      if (task === undefined || !isWithTestAssertion(assertion)) {
        return assertion
      }
      return assertion.withTest(task)
    },
  })
}

/**
 * Installs the `globalThis.__vitest_worker__` state that Vitest's own `vi`,
 * `expect.poll` and `createExpect` read (dist/chunks/utils: `getWorkerState`),
 * scoped to the file being served. Only the fields Vitest reads at runtime are
 * provided; `rpc` and `onCancel` are inert because the vm runner reports
 * through the drain, not through Vitest's worker protocol.
 */
interface EvaluatedModuleStub {
  promise?: Promise<never> | undefined
  evaluated?: boolean | undefined
}

const emptyEvaluatedModules = (): { readonly idToModuleMap: Map<string, EvaluatedModuleStub> } => ({
  idToModuleMap: new Map<string, EvaluatedModuleStub>(),
})

type MetaEnv = Record<string, string | undefined>

const ENV_BOOLEAN_KEYS: ReadonlyArray<string> = ['PROD', 'DEV', 'SSR']

const BASE_URL_DEFAULT = '/'

const processEnvOf = (): Record<string, string | undefined> => Reflect.get(globalThis.process, 'env')

interface EnvWriteOriginal {
  readonly name: string
  readonly original: string | undefined
}
let envWrites: ReadonlyArray<EnvWriteOriginal> | undefined

const recordEnvWrite = (name: string): void => {
  if (envWrites !== undefined && envWrites.some((entry) => entry.name === name)) {
    return
  }
  envWrites = [...(envWrites ?? []), { name, original: processEnvOf()[name] }]
}

const restoreEnvWrites = (): void => {
  const env = processEnvOf()
  for (const { name, original } of envWrites ?? []) {
    if (original === undefined) {
      Reflect.deleteProperty(env, name)
    } else {
      env[name] = original
    }
  }
  envWrites = undefined
}

const seedMetaEnv = (project: VmProjectConfig | undefined): void => {
  const env = processEnvOf()
  const writeDefault = (name: string, value: string): void => {
    if (env[name] !== undefined) {
      return
    }
    recordEnvWrite(name)
    env[name] = value
  }
  writeDefault('MODE', project?.env['MODE'] ?? 'test')
  writeDefault('BASE_URL', project?.env['BASE_URL'] ?? BASE_URL_DEFAULT)
}

const createMetaEnv = (): MetaEnv =>
  new Proxy(processEnvOf(), {
    get(target, key) {
      if (typeof key !== 'string') {
        return undefined
      }
      if (ENV_BOOLEAN_KEYS.includes(key)) {
        return Boolean(target[key])
      }
      return target[key]
    },
    set(target, key, value: string) {
      if (typeof key !== 'string') {
        return true
      }
      recordEnvWrite(key)
      target[key] = ENV_BOOLEAN_KEYS.includes(key) ? (value ? '1' : '') : value
      return true
    },
    deleteProperty(target, key) {
      if (typeof key !== 'string') {
        return true
      }
      recordEnvWrite(key)
      Reflect.deleteProperty(target, key)
      return true
    },
  })

interface EnclosingWorkerState {
  rpc?: object | undefined
  onCancel?: (() => () => undefined) | undefined
  filepath?: string | undefined
  current?: RunnerTest | undefined
  [key: string]: AnyDecoded
}

const isWorkerState = (value: AnyDecoded): value is EnclosingWorkerState => Predicate.isObject(value)

const workerStateOf = (): EnclosingWorkerState | undefined =>
  Option.getOrUndefined(Option.liftPredicate(isWorkerState)(Reflect.get(globalThis, '__vitest_worker__')))

let hostWorkerState: EnclosingWorkerState | undefined
let hostWorkerStateCaptured = false

export const restoreHostWorkerState = (): void => {
  if (hostWorkerStateCaptured) {
    Reflect.set(globalThis, '__vitest_worker__', hostWorkerState)
    hostWorkerStateCaptured = false
    hostWorkerState = undefined
  }
}

export const installWorkerState = (options: {
  readonly config: VmProjectConfig | undefined
  readonly filepath: string
  readonly environmentName: string
  readonly vitestIndex?: VitestModuleNamespace | undefined
}): void => {
  const project = options.config
  const enclosing = workerStateOf()
  if (!hostWorkerStateCaptured) {
    hostWorkerState = enclosing
    hostWorkerStateCaptured = true
  }
  restoreEnvWrites()
  seedMetaEnv(project)
  const state = {
    ctx: {
      pool: 'vmThreads',
      projectName: project?.name ?? '',
      workerId: 1,
      concurrencyId: 1,
      providedContext: readGlobalState()?.provided ?? {},
      environment: { name: options.environmentName },
    },
    config: {
      root: project?.root ?? '',
      testTimeout: project?.testTimeout ?? 5000,
      hookTimeout: project?.hookTimeout ?? 10000,
      retry: project?.retry ?? 0,
      repeats: project?.repeats ?? 0,
      maxConcurrency: project?.maxConcurrency ?? 5,
      clearMocks: project?.clearMocks ?? false,
      mockReset: project?.mockReset ?? false,
      restoreMocks: project?.restoreMocks ?? false,
      unstubEnvs: project?.unstubEnvs ?? false,
      unstubGlobals: project?.unstubGlobals ?? false,
      fakeTimers: project?.fakeTimers ?? {},
      expect: project?.expect ?? { requireAssertions: false, poll: { timeout: 1000, interval: 50 } },
      snapshotOptions: { updateSnapshot: 'none', expand: false, snapshotEnvironment: undefined },
      sequence: {
        concurrent: project?.sequence.concurrent ?? false,
        shuffle: project?.sequence.shuffle ?? false,
        ...(project?.sequence.seed !== undefined ? { seed: project.sequence.seed } : {}),
        hooks: project?.sequence.hooks ?? 'stack',
        setupFiles: project?.sequence.setupFiles ?? 'parallel',
      },
      defines: project?.define ?? {},
      metaEnv: undefined,
      provide: readGlobalState()?.provided ?? {},
    },
    rpc: enclosing?.rpc ?? {},
    filepath: options.filepath,
    vitestIndex: options.vitestIndex,
    metaEnv: createMetaEnv(),
    environment: { name: options.environmentName },
    evaluatedModules: emptyEvaluatedModules(),
    resolvingModules: new Set<string>(),
    moduleExecutionInfo: new Map<string, object>(),
    providedContext: readGlobalState()?.provided ?? {},
    onCancel: enclosing?.onCancel ?? (() => () => undefined),
    onCleanup: () => () => undefined,
    durations: { environment: 0, prepare: 0, fetch: 0 },
    current: undefined,
  }
  Reflect.set(globalThis, '__vitest_worker__', state)
}

export const setWorkerTestPath = (filepath: string): void => {
  const workerState = workerStateOf()
  if (workerState !== undefined) {
    workerState.filepath = filepath
  }
}

export const setWorkerCurrentTask = (task: RunnerTest | undefined): void => {
  const workerState = workerStateOf()
  if (workerState !== undefined) {
    workerState.current = task
  }
}
