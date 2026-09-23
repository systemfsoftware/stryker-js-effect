import { INSTRUMENTER_CONSTANTS } from '@systemfsoftware/stryker-js-instrumenter'
import type { MutantCoverage, MutantRunOptions } from '@systemfsoftware/stryker-js-instrumenter'
import {
  type CompleteDryRunResult,
  type DryRunOptions,
  type DryRunResult,
  type MutantRunResult,
  type TestResult,
  type TestRunnerCapabilities,
  type TestRunnerConfig,
  TestRunnerFailed,
  toMutantRunResult,
} from '@systemfsoftware/stryker-js-plugin-interface'
import * as Context from 'effect/Context'
import * as Effect from 'effect/Effect'
import * as Match from 'effect/Match'
import * as Predicate from 'effect/Predicate'
import * as Semaphore from 'effect/Semaphore'

import {
  activateSandbox,
  createHarnessApi,
  createRegistry,
  deactivateSandbox,
  drainRegistry,
  guardedExpect,
  guardedVi,
  installInterception,
  makeEffectMethods,
  nativeImport,
  uninstallInterception,
  writeGlobalState,
} from '@systemfsoftware/stryker-vm-harness'
import type { HarnessModuleBuiltin, TestRegistry, VmRunnerGlobalState } from '@systemfsoftware/stryker-vm-harness'
import type { PooledTestRunner } from './TestRunner.js'

export interface VmFileUrl {
  readonly href: string
}

export interface VmPlatform {
  readonly moduleBuiltin: HarnessModuleBuiltin
  readonly pathToFileURL: (path: string) => VmFileUrl
}
export class VmRunner extends Context.Service<VmRunner, VmPlatform>()('@systemfsoftware/stryker-js/VmRunner') {}

export const vmRunnerName = 'vm'

export const ALL_TESTS_ID = 'all'
export const ALL_TESTS_NAME = 'All tests'

export const isVmRunner = (name: TestRunnerConfig): name is 'vm' =>
  typeof name === 'string' && name.toLowerCase() === vmRunnerName

export const vmRunnerCapabilities = { reloadEnvironment: true } as const satisfies TestRunnerCapabilities

export interface VmTestRunnerConfig {
  readonly testFiles: readonly string[]
  readonly sandboxWorkingDirectory?: string
}

const errorText = <A = unknown>(error: A): string =>
  Match.value(error).pipe(
    Match.when(Match.instanceOf(Error), (failure) => failure.message),
    Match.orElse((value) => String(value)),
  )

const isInitFailure = <A = unknown>(error: A): boolean => {
  if (error instanceof SyntaxError) {
    return true
  }
  if (typeof error !== 'object' || error === null) {
    return false
  }
  if ('code' in error && error.code === 'ERR_MODULE_NOT_FOUND') {
    return true
  }
  return error instanceof Error && error.message.includes('[PARSE_ERROR]')
}

interface RunFailure {
  readonly file: string
  readonly message: string
  readonly fatal: boolean
}

const runFailureFor = <A = unknown>(file: string, cause: A): RunFailure => {
  const fatal = isInitFailure(cause)
  const message = fatal
    ? `Could not load "${file}" for the in-memory runner: ${errorText(cause)}`
    : errorText(cause)
  return { file, message, fatal }
}

let saltCounter = 0

const isPlainObject = <A = unknown>(value: unknown): value is Record<string, A> => Predicate.isObject(value)

const descriptorValue = <A = unknown>(descriptor: TypedPropertyDescriptor<A> | undefined): A | undefined =>
  descriptor === undefined ? undefined : descriptor.value

const hostStrykerNamespace = <A = unknown>(): Record<string, A> => {
  const current = descriptorValue<Record<string, A>>(
    Object.getOwnPropertyDescriptor(globalThis, INSTRUMENTER_CONSTANTS.NAMESPACE),
  )
  if (isPlainObject<A>(current)) {
    return current
  }
  const created: Record<string, A> = {}
  Object.defineProperty(globalThis, INSTRUMENTER_CONSTANTS.NAMESPACE, {
    configurable: true,
    enumerable: true,
    value: created,
    writable: true,
  })
  return created
}

const monolithicResult = (failureMessage: string, timeSpentMs: number): CompleteDryRunResult => ({
  status: 'complete' as const,
  tests: [
    {
      id: ALL_TESTS_ID,
      name: ALL_TESTS_NAME,
      status: 'failed' as const,
      failureMessage,
      timeSpentMs,
    },
  ],
})

const noTestsFound = (): TestRunnerFailed =>
  TestRunnerFailed.make({
    runnerName: vmRunnerName,
    phase: 'init',
    cause:
      'The "vm" test runner ran zero tests. Set the "testFiles" option so it knows which files to load, or use testRunner "vitest" or "command".',
  })

const prefixOf = (file: string, pathToFileURL: (path: string) => VmFileUrl): string => {
  const href = pathToFileURL(file).href
  const lastSlash = href.lastIndexOf('/')
  return href.slice(0, lastSlash + 1)
}

const commonPrefixOf = (files: readonly string[], pathToFileURL: (path: string) => VmFileUrl): string => {
  const dirs = files.map((file) => prefixOf(file, pathToFileURL))
  let prefix = dirs[0] ?? ''
  for (const dir of dirs.slice(1)) {
    while (prefix !== '' && !dir.startsWith(prefix)) {
      const cut = prefix.lastIndexOf('/', prefix.length - 2)
      prefix = cut > 0 ? prefix.slice(0, cut + 1) : ''
    }
  }
  return prefix
}

interface LoadedGraph {
  readonly registry: TestRegistry
  readonly files: readonly string[]
}

interface RunRequest {
  readonly testFiles: readonly string[]
  readonly timeoutMs: number | undefined
  readonly activeMutantId: string | undefined
  readonly collectCoverage: boolean
  readonly testFilter: readonly string[] | undefined
  readonly hitLimit: number | undefined
  readonly reloadEnvironment: boolean
}

const fileOfTestId = (testId: string): string | undefined => {
  const at = testId.indexOf('#')
  return at === -1 ? undefined : testId.slice(0, at)
}

const graphCoversFilter = (graph: LoadedGraph, testFilter: readonly string[] | undefined): boolean => {
  if (testFilter === undefined || testFilter.length === 0) {
    return true
  }
  const loaded = new Set(graph.files)
  return testFilter.every((testId) => {
    const file = fileOfTestId(testId)
    return file !== undefined && loaded.has(file)
  })
}

const ownedFilesOf = (
  testFiles: readonly string[],
  testFilter: readonly string[] | undefined,
): readonly string[] => {
  if (testFilter === undefined || testFilter.length === 0) {
    return testFiles
  }
  const owners = new Set<string>()
  for (const testId of testFilter) {
    const file = fileOfTestId(testId)
    if (file !== undefined) {
      owners.add(file)
    }
  }
  const owned = testFiles.filter((file) => owners.has(file))
  return owned.length > 0 ? owned : testFiles
}

type NamespaceValue = boolean | number | string | MutantCoverage | undefined

type StrykerNamespace = Record<string, NamespaceValue>

const resetMutantCoverage = (namespace: StrykerNamespace): void => {
  const key = INSTRUMENTER_CONSTANTS.MUTATION_COVERAGE_OBJECT
  const existing = namespace[key]
  if (isCoverage(existing)) {
    const mutable = existing as { -readonly [K in keyof MutantCoverage]: MutantCoverage[K] }
    mutable.static = {}
    mutable.perTest = {}
    return
  }
  namespace[key] = { perTest: {}, static: {} }
}

const isCoverage = (value: NamespaceValue): value is MutantCoverage =>
  isPlainObject(value) && isPlainObject(value.static) && isPlainObject(value.perTest)

const readMutantCoverage = (namespace: StrykerNamespace): MutantCoverage | undefined => {
  const coverage = namespace[INSTRUMENTER_CONSTANTS.MUTATION_COVERAGE_OBJECT]
  if (!isCoverage(coverage)) {
    return undefined
  }
  const perTest: Record<string, Record<string, number>> = {}
  for (const [testId, hits] of Object.entries(coverage.perTest)) {
    if (isPlainObject<number>(hits)) {
      perTest[testId] = { ...hits }
    }
  }
  return { perTest, static: { ...coverage.static } }
}

const serialRunGate = Semaphore.makeUnsafe(1)

const runOnce = (
  platform: VmPlatform,
  request: RunRequest,
  current: LoadedGraph | undefined,
  sandboxWorkingDirectory: string | undefined,
): Effect.Effect<
  { readonly result: DryRunResult; readonly graph: LoadedGraph | undefined },
  TestRunnerFailed
> =>
  Effect.gen(function*() {
    const namespace: StrykerNamespace = hostStrykerNamespace<NamespaceValue>()
    const previousActive = namespace[INSTRUMENTER_CONSTANTS.ACTIVE_MUTANT]
    const previousHitCount = namespace[INSTRUMENTER_CONSTANTS.HIT_COUNT]
    const previousHitLimit = namespace[INSTRUMENTER_CONSTANTS.HIT_LIMIT]
    const previousTestId = namespace[INSTRUMENTER_CONSTANTS.CURRENT_TEST_ID]
    namespace[INSTRUMENTER_CONSTANTS.ACTIVE_MUTANT] = request.activeMutantId
    if (request.activeMutantId === undefined) {
      namespace[INSTRUMENTER_CONSTANTS.HIT_COUNT] = undefined
      namespace[INSTRUMENTER_CONSTANTS.HIT_LIMIT] = undefined
    } else {
      namespace[INSTRUMENTER_CONSTANTS.HIT_COUNT] = 0
      namespace[INSTRUMENTER_CONSTANTS.HIT_LIMIT] = request.hitLimit
    }
    if (request.collectCoverage) {
      resetMutantCoverage(namespace)
    }

    const reusable = request.reloadEnvironment === false &&
        current !== undefined &&
        graphCoversFilter(current, request.testFilter)
      ? current
      : undefined

    let armed = false
    try {
      if (reusable === undefined && request.testFiles[0] === undefined) {
        return yield* noTestsFound()
      }
      let graph: LoadedGraph
      let runFailure: RunFailure | undefined
      if (reusable !== undefined) {
        graph = reusable
      } else {
        const registry = createRegistry()
        const api = createHarnessApi(registry)
        const real = yield* Effect.tryPromise({
          try: () => import('vitest'),
          catch: (cause) =>
            TestRunnerFailed.make({
              runnerName: vmRunnerName,
              phase: 'init',
              cause: cause instanceof Error ? cause.message : 'the vitest module failed to load',
            }),
        })
        const state: VmRunnerGlobalState = {
          api,
          expect: guardedExpect(real.expect),
          vi: guardedVi(real.vi),
          effectVitest: {
            it: makeEffectMethods({
              api: api.it,
              describe: api.describe,
              hooks: api.hooks,
              tests: registry.tests,
            }),
          },
        }

        const prefix = sandboxWorkingDirectory !== undefined
          ? `${platform.pathToFileURL(sandboxWorkingDirectory).href.replace(/\/?$/, '/')}`
          : commonPrefixOf(request.testFiles, platform.pathToFileURL)

        installInterception(platform.moduleBuiltin)
        activateSandbox(prefix)
        writeGlobalState(state)
        armed = true

        const files = ownedFilesOf(request.testFiles, request.testFilter)
        const salt = saltCounter++
        for (const file of files) {
          registry.files.current = file
          registry.frames.current = []
          const url = `${platform.pathToFileURL(file).href}?salt=${salt}`
          const outcome = yield* Effect.promise(() =>
            nativeImport(url).then(
              () => undefined,
              <A = unknown>(cause: A) => ({ cause }),
            )
          )
          if (outcome !== undefined) {
            const failure = runFailureFor(file, outcome.cause)
            if (failure.fatal) {
              return yield* TestRunnerFailed.make({
                runnerName: vmRunnerName,
                phase: 'init',
                cause: failure.message,
              })
            }
            runFailure ??= failure
          }
        }
        graph = { registry, files }
      }
      const onTestStart = request.collectCoverage
        ? (testId: string): void => {
          namespace[INSTRUMENTER_CONSTANTS.CURRENT_TEST_ID] = testId
        }
        : undefined
      const onTestEnd = request.collectCoverage
        ? (): void => {
          namespace[INSTRUMENTER_CONSTANTS.CURRENT_TEST_ID] = undefined
        }
        : undefined
      const outcome = yield* Effect.promise(() =>
        drainRegistry(graph.registry, request.timeoutMs, {
          testFilter: request.testFilter,
          onTestStart,
          onTestEnd,
        })
      )
      if (outcome.kind === 'timeout') {
        return { result: { status: 'timeout' }, graph }
      }
      const drainedElapsed = outcome.tests.reduce((total, test) => total + test.timeSpentMs, 0)
      if (graph.registry.tests.length === 0) {
        if (runFailure === undefined) {
          return yield* noTestsFound()
        }
        return { result: monolithicResult(runFailure.message, drainedElapsed), graph }
      }
      const tests: TestResult[] = outcome.tests.map((test): TestResult => {
        const base = {
          id: `${test.file}#${test.fullName}`,
          name: test.fullName,
          timeSpentMs: test.timeSpentMs,
        }
        if (test.status === 'failed') {
          return { ...base, status: 'failed', failureMessage: test.failureMessage ?? '' }
        }
        return test.status === 'skipped' ? { ...base, status: 'skipped' } : { ...base, status: 'success' }
      })
      if (runFailure !== undefined) {
        tests.push({
          id: `${runFailure.file}#load error`,
          name: `${runFailure.file} (load error)`,
          status: 'failed',
          failureMessage: runFailure.message,
          timeSpentMs: 0,
        })
      }
      const mutantCoverage = request.collectCoverage ? readMutantCoverage(namespace) : undefined
      const result = mutantCoverage === undefined
        ? { status: 'complete' as const, tests }
        : { status: 'complete' as const, tests, mutantCoverage }
      return { result, graph }
    } finally {
      if (armed) {
        writeGlobalState(undefined)
        deactivateSandbox()
        uninstallInterception()
      }
      namespace[INSTRUMENTER_CONSTANTS.ACTIVE_MUTANT] = previousActive
      namespace[INSTRUMENTER_CONSTANTS.HIT_COUNT] = previousHitCount
      namespace[INSTRUMENTER_CONSTANTS.HIT_LIMIT] = previousHitLimit
      namespace[INSTRUMENTER_CONSTANTS.CURRENT_TEST_ID] = previousTestId
    }
  })

export const vmTestRunner = (
  config: VmTestRunnerConfig,
): Effect.Effect<PooledTestRunner, TestRunnerFailed, VmRunner> =>
  Effect.gen(function*() {
    const platform = yield* VmRunner

    let loaded: LoadedGraph | undefined

    const run = (request: RunRequest) =>
      serialRunGate.withPermits(1)(
        Effect.gen(function*() {
          const outcome = yield* runOnce(platform, request, loaded, config.sandboxWorkingDirectory)
          loaded = outcome.graph
          return outcome.result
        }),
      )

    const testFilesOf = (override: readonly string[] | undefined): readonly string[] =>
      Match.value(config.testFiles).pipe(
        Match.when((files) => files.length > 0, (files) => files),
        Match.orElse(() => override ?? []),
      )

    return {
      capabilities: Effect.succeed(vmRunnerCapabilities),
      init: Effect.void,
      dryRun: (options: DryRunOptions) =>
        run({
          testFiles: testFilesOf(options.testFiles),
          timeoutMs: options.timeout,
          activeMutantId: undefined,
          collectCoverage: true,
          testFilter: undefined,
          hitLimit: undefined,
          reloadEnvironment: true,
        }),
      mutantRun: (options: MutantRunOptions) =>
        run({
          testFiles: config.testFiles.length > 0 ? config.testFiles : (loaded?.files ?? []),
          timeoutMs: options.timeout,
          activeMutantId: String(options.activeMutant.id),
          collectCoverage: false,
          testFilter: options.testFilter,
          hitLimit: options.hitLimit,
          reloadEnvironment: options.reloadEnvironment,
        }).pipe(
          Effect.map((result) => toMutantRunResult(result, true)),
          Effect.catchTag(
            'TestRunnerFailed',
            (failure): Effect.Effect<MutantRunResult> =>
              Effect.succeed(toMutantRunResult({ status: 'error', errorMessage: failure.cause }, true)),
          ),
        ),
    }
  })
