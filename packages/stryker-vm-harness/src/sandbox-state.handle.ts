import { dual } from 'effect/Function'
import * as Option from 'effect/Option'
import * as Predicate from 'effect/Predicate'

import { STATE_KEY } from './harness-sources.handle.js'
import type { RunnerTest } from './registry.schema.js'
import type { ProvidedValue, VmRunnerGlobalState } from './sandbox.schema.js'
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

interface Callable {
  (...args: ReadonlyArray<never>): object
}

const isCallable = (value: AnyDecoded): value is Callable => typeof value === 'function'

const applyResetter = (vi: object, method: string): void => {
  const reset: AnyDecoded = Reflect.get(vi, method)
  if (isCallable(reset)) Reflect.apply(reset, vi, [])
}

const resetMockFor = (vi: object, flags: MockResetFlags, method: string, flag: keyof MockResetFlags): void => {
  if (flags[flag]) applyResetter(vi, method)
}

const forEachResetter = (vi: object, flags: MockResetFlags): void => {
  for (const [method, flag] of Object.entries(VI_RESETTER_FLAGS)) {
    resetMockFor(vi, flags, method, flag)
  }
}

const viOfState = (): object | undefined => readGlobalState()?.vi

export const mockResetConfigOf = (flags: MockResetFlags): void => {
  const vi = viOfState()
  if (vi === undefined) {
    return
  }
  forEachResetter(vi, flags)
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

const enrichObjectAssertion = (assertion: object, task: object): AnyDecoded =>
  isWithTestAssertion(assertion) ? assertion.withTest(task) : assertion

const enrichAssertionWithTask = (assertion: AnyDecoded, task: object): AnyDecoded =>
  Predicate.isObject(assertion) ? enrichObjectAssertion(assertion, task) : assertion

const enrichAssertion = (assertion: AnyDecoded, task: object | undefined): AnyDecoded =>
  task === undefined ? assertion : enrichAssertionWithTask(assertion, task)

export const withRunnerTask: {
  (expect: object, currentTask: () => object | undefined): object
  (currentTask: () => object | undefined): (expect: object) => object
} = dual(
  2,
  (expect: object, currentTask: () => object | undefined): object => {
    if (!isExpectCallable(expect)) {
      return expect
    }
    return new Proxy(expect, {
      apply: (target, thisArg, args) => enrichAssertion(Reflect.apply(target, thisArg, args), currentTask()),
    })
  },
)

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

const previousEnvWrites = (): ReadonlyArray<EnvWriteOriginal> => envWrites ?? []

const alreadyRecordedEnvWrite = (name: string): boolean =>
  envWrites !== undefined && envWrites.some((entry) => entry.name === name)

const recordEnvWrite = (name: string): void => {
  if (alreadyRecordedEnvWrite(name)) {
    return
  }
  envWrites = [...previousEnvWrites(), { name, original: processEnvOf()[name] }]
}

const restoreEnvWrite = (
  env: Record<string, string | undefined>,
  name: string,
  original: string | undefined,
): void => {
  if (original === undefined) {
    Reflect.deleteProperty(env, name)
  } else {
    env[name] = original
  }
}

const restoreEnvWrites = (): void => {
  const env = processEnvOf()
  for (const entry of previousEnvWrites()) {
    restoreEnvWrite(env, entry.name, entry.original)
  }
  envWrites = undefined
}

const orFallback = <A>(value: A | undefined, fallback: A): A => value ?? fallback

const projectEnvValueOf = (project: VmProjectConfig | undefined, name: string): string | undefined => project?.env[name]

const seedMetaEnv = (project: VmProjectConfig | undefined): void => {
  const env = processEnvOf()
  const writeDefault = (name: string, value: string): void => {
    if (env[name] !== undefined) {
      return
    }
    recordEnvWrite(name)
    env[name] = value
  }
  writeDefault('MODE', orFallback(projectEnvValueOf(project, 'MODE'), 'test'))
  writeDefault('BASE_URL', orFallback(projectEnvValueOf(project, 'BASE_URL'), BASE_URL_DEFAULT))
}

const metaEnvRead = (target: MetaEnv, key: string): string | boolean | undefined =>
  ENV_BOOLEAN_KEYS.includes(key) ? Boolean(target[key]) : target[key]

const metaEnvGetOf = (target: MetaEnv, key: string | symbol): string | boolean | undefined =>
  typeof key === 'string' ? metaEnvRead(target, key) : undefined

const envBooleanText = (value: string): string => value === '' ? '' : '1'

const metaEnvText = (key: string, value: string): string =>
  ENV_BOOLEAN_KEYS.includes(key) ? envBooleanText(value) : value

const metaEnvSetOf = (target: MetaEnv, key: string | symbol, value: string): boolean => {
  if (typeof key !== 'string') {
    return true
  }
  recordEnvWrite(key)
  target[key] = metaEnvText(key, value)
  return true
}

const metaEnvDeleteOf = (target: MetaEnv, key: string | symbol): boolean => {
  if (typeof key !== 'string') {
    return true
  }
  recordEnvWrite(key)
  Reflect.deleteProperty(target, key)
  return true
}

const createMetaEnv = (): MetaEnv =>
  new Proxy(processEnvOf(), {
    get: (target, key) => metaEnvGetOf(target, key),
    set: (target, key, value: string) => metaEnvSetOf(target, key, value),
    deleteProperty: (target, key) => metaEnvDeleteOf(target, key),
  })

interface EnclosingWorkerState {
  rpc?: object | undefined
  onCancel?: (() => () => undefined) | undefined
  filepath?: string | undefined
  current?: RunnerTest | undefined
  [key: string]: AnyDecoded
}

const isWorkerState = (value: AnyDecoded): value is EnclosingWorkerState => Predicate.isObject(value)

export const workerStateOf = (): EnclosingWorkerState | undefined =>
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

const captureHostWorkerState = (enclosing: EnclosingWorkerState | undefined): void => {
  if (hostWorkerStateCaptured) {
    return
  }
  hostWorkerState = enclosing
  hostWorkerStateCaptured = true
}

const enclosingFieldOf = <K extends 'rpc' | 'onCancel', A>(
  state: EnclosingWorkerState | undefined,
  key: K,
  fallback: A,
): EnclosingWorkerState[K] | A => orFallback<EnclosingWorkerState[K] | A>(state?.[key], fallback)

const fieldOf = <K extends keyof VmProjectConfig, A>(
  project: VmProjectConfig | undefined,
  key: K,
  fallback: A,
): VmProjectConfig[K] | A => orFallback<VmProjectConfig[K] | A>(project?.[key], fallback)

const projectSequenceOf = (project: VmProjectConfig | undefined): VmProjectConfig['sequence'] | undefined =>
  project?.sequence

const sequenceFieldOf = <K extends keyof VmProjectConfig['sequence'], A>(
  sequence: VmProjectConfig['sequence'] | undefined,
  key: K,
  fallback: A,
): VmProjectConfig['sequence'][K] | A => orFallback<VmProjectConfig['sequence'][K] | A>(sequence?.[key], fallback)

const seedOf = (sequence: VmProjectConfig['sequence'] | undefined): number | undefined => sequence?.seed

const seedEntryOf = (seed: number | undefined): { readonly seed?: number } => seed === undefined ? {} : { seed }

const workerSequenceOf = (project: VmProjectConfig | undefined): object => {
  const sequence = projectSequenceOf(project)
  return {
    concurrent: sequenceFieldOf(sequence, 'concurrent', false),
    shuffle: sequenceFieldOf(sequence, 'shuffle', false),
    hooks: sequenceFieldOf(sequence, 'hooks', 'stack'),
    setupFiles: sequenceFieldOf(sequence, 'setupFiles', 'parallel'),
    ...seedEntryOf(seedOf(sequence)),
  }
}

const globalStateProvided = (): Record<string, ProvidedValue | undefined> | undefined => readGlobalState()?.provided

const providedOf = (): Record<string, ProvidedValue | undefined> => globalStateProvided() ?? {}

const DEFAULT_EXPECT: VmProjectConfig['expect'] = {
  requireAssertions: false,
  poll: { timeout: 1000, interval: 50 },
}

interface WorkerStateInput {
  readonly config: VmProjectConfig | undefined
  readonly filepath: string
  readonly environmentName: string
  readonly vitestIndex?: VitestModuleNamespace | undefined
}

const workerCtxOf = (options: WorkerStateInput, project: VmProjectConfig | undefined): object => ({
  pool: 'vmThreads',
  projectName: fieldOf(project, 'name', ''),
  workerId: 1,
  concurrencyId: 1,
  providedContext: providedOf(),
  environment: { name: options.environmentName },
})

const workerConfigOf = (project: VmProjectConfig | undefined): object => ({
  root: fieldOf(project, 'root', ''),
  testTimeout: fieldOf(project, 'testTimeout', 5000),
  hookTimeout: fieldOf(project, 'hookTimeout', 10000),
  retry: fieldOf(project, 'retry', 0),
  repeats: fieldOf(project, 'repeats', 0),
  maxConcurrency: fieldOf(project, 'maxConcurrency', 5),
  clearMocks: fieldOf(project, 'clearMocks', false),
  mockReset: fieldOf(project, 'mockReset', false),
  restoreMocks: fieldOf(project, 'restoreMocks', false),
  unstubEnvs: fieldOf(project, 'unstubEnvs', false),
  unstubGlobals: fieldOf(project, 'unstubGlobals', false),
  fakeTimers: fieldOf(project, 'fakeTimers', {}),
  expect: fieldOf(project, 'expect', DEFAULT_EXPECT),
  snapshotOptions: { updateSnapshot: 'none', expand: false, snapshotEnvironment: undefined },
  sequence: workerSequenceOf(project),
  defines: fieldOf(project, 'define', {}),
  metaEnv: undefined,
  provide: providedOf(),
})

const NO_CANCEL = (): () => undefined => () => undefined

interface WorkerStateSpec {
  readonly options: WorkerStateInput
  readonly project: VmProjectConfig | undefined
  readonly enclosing: EnclosingWorkerState | undefined
}

const workerStateSpecOf = (spec: WorkerStateSpec): object => ({
  ctx: workerCtxOf(spec.options, spec.project),
  config: workerConfigOf(spec.project),
  rpc: enclosingFieldOf(spec.enclosing, 'rpc', {}),
  filepath: spec.options.filepath,
  vitestIndex: spec.options.vitestIndex,
  metaEnv: createMetaEnv(),
  environment: { name: spec.options.environmentName },
  evaluatedModules: emptyEvaluatedModules(),
  resolvingModules: new Set<string>(),
  moduleExecutionInfo: new Map<string, object>(),
  providedContext: providedOf(),
  onCancel: enclosingFieldOf(spec.enclosing, 'onCancel', NO_CANCEL),
  onCleanup: () => () => undefined,
  durations: { environment: 0, prepare: 0, fetch: 0 },
  current: undefined,
})

export const installWorkerState = (options: {
  readonly config: VmProjectConfig | undefined
  readonly filepath: string
  readonly environmentName: string
  readonly vitestIndex?: VitestModuleNamespace | undefined
}): void => {
  const project = options.config
  const enclosing = workerStateOf()
  captureHostWorkerState(enclosing)
  restoreEnvWrites()
  seedMetaEnv(project)
  Reflect.set(globalThis, '__vitest_worker__', workerStateSpecOf({ options, project, enclosing }))
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
