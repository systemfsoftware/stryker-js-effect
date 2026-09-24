import { Cell } from '@systemfsoftware/effect-cell-types'
import * as Effect from 'effect/Effect'

import type { HarnessApi, RunnerTest } from '../core/registry.js'
import { STATE_KEY } from '../core/sources.js'
import type { VmProjectConfig } from '../core/vitest-config.schema.js'
import type { VitestModuleNamespace } from './session-plugin.js'

export interface EffectVitestSurface<A = unknown> {
  readonly it: A
}

export type ProvidedValue = object | string | number | boolean | null

export interface VmRunnerGlobalState {
  readonly api: HarnessApi
  readonly expect: object | undefined
  readonly vi: object | undefined
  readonly effectVitest: EffectVitestSurface | undefined
  readonly projectConfig: VmProjectConfig | undefined
  readonly provided: Record<string, ProvidedValue | undefined>
}

export const readGlobalState = (): VmRunnerGlobalState | undefined =>
  (globalThis as Record<symbol, VmRunnerGlobalState | undefined>)[STATE_KEY]

export const writeGlobalState = (state: VmRunnerGlobalState | undefined): void => {
  ;(globalThis as Record<symbol, VmRunnerGlobalState | undefined>)[STATE_KEY] = state
}

export const readGlobalStateCell: Cell.Cell<void, VmRunnerGlobalState | undefined> = Cell.fromEffect(
  Effect.sync(readGlobalState),
)

export const writeGlobalStateCell: Cell.Cell<VmRunnerGlobalState | undefined, void> = Cell.mapInput(
  Cell.id<VmRunnerGlobalState | undefined>(),
  (state) => {
    writeGlobalState(state)
    return undefined
  },
)

export const globalConfigOf = (): VmProjectConfig | undefined => readGlobalState()?.projectConfig

export const providedValueOf = (name: string): ProvidedValue | undefined => readGlobalState()?.provided[name]

interface ExpectStateLike {
  assertionCalls: number
  expectedAssertionsNumber: number | null | undefined
  isExpectingAssertions: boolean | undefined
}

export interface ExpectStatePatch {
  assertionCalls?: number
  isExpectingAssertions?: boolean
  expectedAssertionsNumber?: number | null
  expectedAssertionsNumberErrorGen?: (() => Error) | null
  isExpectingAssertionsError?: Error | null
  currentTestName?: string
}

interface ExpectWithState {
  readonly getState: () => ExpectStateLike
  readonly setState: (state: ExpectStatePatch) => void
}

const expectWithState = (): ExpectWithState | undefined => {
  const expect = readGlobalState()?.expect
  if (expect === undefined || typeof Reflect.get(expect, 'getState') !== 'function') {
    return undefined
  }
  return expect as ExpectWithState
}

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

export const mockResetConfigOf = (flags: MockResetFlags): void => {
  const vi = readGlobalState()?.vi
  if (vi === undefined) {
    return
  }
  const resettable = vi as ResettableVi
  const call = (name: keyof ResettableVi): void => {
    const method = resettable[name]
    if (typeof method === 'function') {
      method.call(resettable)
    }
  }
  if (flags.restoreMocks) {
    call('restoreAllMocks')
  }
  if (flags.mockReset) {
    call('resetAllMocks')
  }
  if (flags.clearMocks) {
    call('clearAllMocks')
  }
  if (flags.unstubEnvs) {
    call('unstubAllEnvs')
  }
  if (flags.unstubGlobals) {
    call('unstubAllGlobals')
  }
}

interface ResettableVi {
  restoreAllMocks?: () => object
  resetAllMocks?: () => object
  clearAllMocks?: () => object
  unstubAllEnvs?: () => object
  unstubAllGlobals?: () => object
}

interface ExpectCallable {
  (value: object, message?: string): object
}

interface WithTestAssertion {
  readonly withTest: (task: object) => object
}

const isWithTestAssertion = (value: object): value is ExpectCallable & WithTestAssertion =>
  typeof (value as Partial<WithTestAssertion>).withTest === 'function'

export const withRunnerTask = (expect: object, currentTask: () => object | undefined): object => {
  const target = expect as ExpectCallable
  return new Proxy(target, {
    apply(innerTarget, thisArg, args) {
      const assertion = Reflect.apply(innerTarget, thisArg, args) as object
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

/**
 * First write to an env name during an install records its pre-run value so the
 * next `installWorkerState` can undo everything the previous file left behind.
 */
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

interface HostWorkerStateHost {
  readonly rpc?: object | undefined
  readonly onCancel?: () => () => undefined
  readonly [key: string]: object | (() => () => undefined) | undefined
}
let hostWorkerState: HostWorkerStateHost | undefined
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
  const enclosing = Reflect.get(globalThis, '__vitest_worker__') as
    | { rpc?: object; onCancel?: () => () => undefined }
    | undefined
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
export const metaEnvOf = (): Record<string, string | undefined> | undefined => {
  const workerState = Reflect.get(globalThis, '__vitest_worker__') as
    | { metaEnv?: Record<string, string | undefined> | undefined }
    | undefined
  const record = workerState?.metaEnv
  return typeof record === 'object' ? record : undefined
}

export const setWorkerTestPath = (filepath: string): void => {
  const workerState = Reflect.get(globalThis, '__vitest_worker__') as
    | { filepath?: string | undefined }
    | undefined
  if (workerState !== undefined) {
    workerState.filepath = filepath
  }
}

export const setWorkerCurrentTask = (task: RunnerTest | undefined): void => {
  const workerState = Reflect.get(globalThis, '__vitest_worker__') as
    | { current?: RunnerTest | undefined }
    | undefined
  if (workerState !== undefined) {
    workerState.current = task
  }
}
