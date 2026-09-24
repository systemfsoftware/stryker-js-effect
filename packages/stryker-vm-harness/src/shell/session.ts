import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

import * as Effect from 'effect/Effect'
import * as HashMap from 'effect/HashMap'
import * as Option from 'effect/Option'
import type { DrainOutcome } from '../core/drain-registry.workflow.js'
import { guardedExpect, guardedVi } from '../core/guards.js'
import { createHarnessApi, createRegistry, type HarnessApi, type TestRegistry } from '../core/registry.js'
import { STATE_KEY } from '../core/sources.js'
import type {
  VmMutantCoverage,
  VmRunRequest,
  VmRunResponse,
  VmSessionOptions,
  VmTestResult,
} from '../core/vm-protocol.schema.js'
import { type DrainTestOutcome, type DrainTestRef, executeDrainRegistry } from './drain-executor.js'
import { makeEffectMethods } from './effect-adapter.js'
import { ENVIRONMENT_KEYS_BAG_KEY } from './environments/environment-activation.js'
import { readGlobalState, restoreHostWorkerState, type VmRunnerGlobalState, writeGlobalState } from './global-state.js'
import { activateSandbox, deactivateSandbox, installInterception, uninstallInterception } from './interception.js'
import { nativeImport } from './native-import.js'
import { builtinPlugins } from './plugins/index.js'
import {
  runStage,
  type VitestModuleNamespace,
  VM_TEST_FILES_BAG_KEY,
  type VmDiscoveredTestFiles,
  type VmFileContext,
  type VmGlobals,
  type VmGraphContext,
  type VmPluginBag,
  type VmPluginHost,
  type VmRunContext,
  type VmSessionPlugin,
  type VmStageArgs,
  type VmStageName,
  type VmTestContext,
} from './session-plugin.js'
import {
  armMutant,
  hostStrykerNamespace,
  readArmedMutant,
  readMutantCoverage,
  resetMutantCoverage,
  type StrykerNamespace,
  writeArmedMutant,
} from './stryker-namespace.js'
import { VM_VITEST_BAG_KEY, type VmVitestRuntime } from './vitest-host/runtime.js'

const ZERO_TESTS_MESSAGE =
  'The "vm" test runner ran zero tests. Set the "testFiles" option so it knows which files to load, or use testRunner "vitest" or "command".'

interface RunFailure {
  readonly file: string
  readonly message: string
  readonly fatal: boolean
}

const messageOf = <A>(value: A): string | undefined =>
  typeof value === 'object' && value !== null && 'message' in value && typeof value.message === 'string'
    ? value.message
    : undefined

const errorText = <A = unknown>(error: A): string => {
  if (error instanceof Error) {
    return error.message
  }
  const carried = messageOf(error)
  if (carried !== undefined) {
    return carried
  }
  return new Error('in-memory runner failure', { cause: error }).message
}

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

const runFailureFor = <A = unknown>(file: string, cause: A): RunFailure => {
  const fatal = isInitFailure(cause)
  const message = fatal
    ? `Could not load "${file}" for the in-memory runner: ${errorText(cause)}`
    : errorText(cause)
  return { file, message, fatal }
}

const vitestMissingMessage = (sandbox: string): string =>
  `Could not resolve the vitest package from the sandbox working directory "${sandbox}". A sandbox must be able to load vitest: install it there, or link a node_modules directory that has it.`

const vitestUnresolvedRefusalFor = <A = unknown>(sandbox: string, cause: A): string | undefined => {
  if (typeof cause !== 'object' || cause === null) {
    return undefined
  }
  if (!('code' in cause) || cause.code !== 'ERR_MODULE_NOT_FOUND') {
    return undefined
  }
  return errorText(cause).includes("Cannot find package 'vitest") ? vitestMissingMessage(sandbox) : undefined
}

const fileOfTestId = (testId: string): string | undefined => {
  const at = testId.indexOf('#')
  return at === -1 ? undefined : testId.slice(0, at)
}

const testIdFor = (sandboxWorkingDirectory: string, file: string, name: string): string => {
  const base = sandboxWorkingDirectory.endsWith('/') ? sandboxWorkingDirectory : `${sandboxWorkingDirectory}/`
  const relative = file.startsWith(base) ? file.slice(base.length).replace(/^\/+/, '') : file
  return `${relative.replaceAll('\\', '/')}#${name}`
}
const absoluteTestIdOf = (sandboxWorkingDirectory: string, testId: string): string => {
  const at = testId.indexOf('#')
  if (at === -1) {
    return testId
  }
  const file = testId.slice(0, at)
  const rest = testId.slice(at + 1)
  if (file.startsWith('/') || /^[A-Za-z]:[\\/]/.test(file)) {
    return testId
  }
  const base = sandboxWorkingDirectory.endsWith('/') ? sandboxWorkingDirectory : `${sandboxWorkingDirectory}/`
  return `${base}${file.replace(/^\/+/, '')}#${rest}`
}

const relativeTestIdOf = (sandboxWorkingDirectory: string, testId: string): string => {
  const at = testId.indexOf('#')
  if (at === -1) {
    return testId
  }
  const base = sandboxWorkingDirectory.endsWith('/') ? sandboxWorkingDirectory : `${sandboxWorkingDirectory}/`
  const file = testId.slice(0, at)
  const relative = file.startsWith(base) ? file.slice(base.length).replace(/^\/+/, '') : file
  return `${relative.replaceAll('\\', '/')}#${testId.slice(at + 1)}`
}

const graphCoversFilter = (files: readonly string[], testFilter: readonly string[] | undefined): boolean => {
  if (testFilter === undefined || testFilter.length === 0) {
    return true
  }
  const loaded = new Set(files)
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

const runnableFilesOf = (declared: readonly string[], discovered: readonly string[] | undefined): readonly string[] => {
  if (discovered === undefined) {
    return declared
  }
  if (declared.length === 0) {
    return discovered
  }
  const runnable = new Set(discovered)
  return declared.filter((file) => runnable.has(file))
}
interface LoadedGraph {
  readonly registry: TestRegistry
  readonly files: readonly string[]
  readonly saltOf: (file: string) => string
}

type GlobalOverlay = ReadonlyMap<string | symbol, PropertyDescriptor>
type GlobalBaseline = ReadonlyMap<string | symbol, PropertyDescriptor | undefined>

const PROTECTED_GLOBAL_KEYS: Record<string, true> = {
  __stryker__: true,
  __vitest_worker__: true,
}

const PROTECTED_GLOBAL_SYMBOLS: ReadonlyArray<symbol> = [STATE_KEY]

const snapshotGlobals = (): ReadonlyMap<string, PropertyDescriptor> =>
  new Map(Object.entries(Object.getOwnPropertyDescriptors(globalThis)))

const snapshotGlobalSymbols = (): ReadonlyMap<symbol, PropertyDescriptor> =>
  new Map(
    Object.getOwnPropertySymbols(globalThis).map((symbol) => [
      symbol,
      Object.getOwnPropertyDescriptor(globalThis, symbol) as PropertyDescriptor,
    ]),
  )

const EMPTY_EXCLUDED_KEYS: ReadonlySet<string> = new Set()

const overlayEntriesOf = (
  baseline: ReadonlyMap<string, PropertyDescriptor>,
  baselineSymbols: ReadonlyMap<symbol, PropertyDescriptor>,
  excludedKeys: ReadonlySet<string>,
): { readonly overlay: GlobalOverlay; readonly restore: GlobalBaseline } => {
  const current = snapshotGlobals()
  const currentSymbols = snapshotGlobalSymbols()
  const overlay = new Map<string | symbol, PropertyDescriptor>()
  const restore = new Map<string | symbol, PropertyDescriptor | undefined>()
  for (const [key, descriptor] of current) {
    if (PROTECTED_GLOBAL_KEYS[key] === true || excludedKeys.has(key)) {
      continue
    }
    const before = baseline.get(key)
    if (
      before !== undefined && before.get === descriptor.get && before.set === descriptor.set &&
      Object.is(before.value, descriptor.value) && before.writable === descriptor.writable &&
      before.enumerable === descriptor.enumerable && before.configurable === descriptor.configurable
    ) {
      continue
    }
    overlay.set(key, descriptor)
    restore.set(key, before)
  }
  for (const key of baseline.keys()) {
    if (current.has(key) || PROTECTED_GLOBAL_KEYS[key] === true || restore.has(key)) {
      continue
    }
    restore.set(key, baseline.get(key))
  }
  for (const [symbol, descriptor] of currentSymbols) {
    if (PROTECTED_GLOBAL_SYMBOLS.includes(symbol)) {
      continue
    }
    const before = baselineSymbols.get(symbol)
    if (
      before !== undefined && before.get === descriptor.get && before.set === descriptor.set &&
      Object.is(before.value, descriptor.value) && before.writable === descriptor.writable &&
      before.enumerable === descriptor.enumerable && before.configurable === descriptor.configurable
    ) {
      continue
    }
    overlay.set(symbol, descriptor)
    restore.set(symbol, before)
  }
  return { overlay, restore }
}
const applyOverlay = (overlay: GlobalOverlay): void => {
  for (const [key, descriptor] of overlay) {
    Object.defineProperty(globalThis, key, descriptor)
  }
}

const restoreBaseline = (restore: GlobalBaseline): void => {
  for (const [key, original] of restore) {
    if (original === undefined) {
      Reflect.deleteProperty(globalThis, key)
    } else {
      Object.defineProperty(globalThis, key, original)
    }
  }
}

export interface VmSession {
  readonly run: (request: VmRunRequest) => Promise<VmRunResponse>
  readonly dispose: () => Promise<void>
}

export interface LoadedGraphBuild {
  readonly graph: LoadedGraph
  readonly failure: RunFailure | undefined
}

export interface RefusedGraphBuild {
  readonly refusal: string
}
let saltCounter = 0
const installExitGuard = (sandboxWorkingDirectory: string): () => void => {
  const runner = globalThis.process
  const original = runner.exit.bind(runner)
  const guarded: typeof runner.exit = (code?: number): never => {
    const workerState = Reflect.get(globalThis, '__vitest_worker__') as
      | { readonly filepath?: string | undefined }
      | undefined
    const filepath = typeof workerState?.filepath === 'string' && workerState.filepath.length > 0
      ? workerState.filepath
      : sandboxWorkingDirectory
    throw new Error(`process.exit unexpectedly called with "${String(code)}" (test file: ${filepath})`)
  }
  runner.exit = guarded
  return () => {
    if (runner.exit === guarded) {
      runner.exit = original
    }
  }
}

export const createVmSession = (
  options: VmSessionOptions,
  plugins: readonly VmSessionPlugin[] = builtinPlugins,
): Promise<VmSession> => {
  const prefix = pathToFileURL(options.sandboxWorkingDirectory).href.replace(/\/?$/, '/')
  const isolate = options.isolate ?? true
  const saltOwners = new Map<string, string>()
  const ownerOfSalt = (salt: string): string | undefined => saltOwners.get(salt)
  let graph: LoadedGraph | undefined
  let activeFiles: readonly string[] = []
  let installedApi: HarnessApi | undefined
  let restoreExit: (() => void) | undefined
  let disposed = false
  let queue: Promise<void> = Promise.resolve()
  let activeRegistry: TestRegistry | undefined
  let baselineGlobals: ReadonlyMap<string, PropertyDescriptor> | undefined
  let baselineGlobalSymbols: ReadonlyMap<symbol, PropertyDescriptor> | undefined
  const fileOverlays = new Map<string, { readonly overlay: GlobalOverlay; readonly restore: GlobalBaseline }>()
  let entryRefusal: string | undefined
  const sandboxBase = new URL('noop.js', `${prefix}`)

  const fileUrlFor = (file: string, salt: string): string => `${pathToFileURL(file).href}?salt=${salt}`

  const resolveSandboxEntry = (): string | undefined => {
    try {
      return vitestEntry()
    } catch {
      return undefined
    }
  }

  let bagStore = HashMap.empty<string, object>()
  const bag: VmPluginBag = {
    read: <A extends object>(key: string) => Option.getOrUndefined(HashMap.get(bagStore, key)) as A | undefined,
    write: <A extends object>(key: string, value: A) => {
      bagStore = HashMap.set(bagStore, key, value)
    },
  }

  const environmentInstalledKeys = new Set<string>()
  const absorbEnvironmentKeys = (): void => {
    const published = bag.read<{ readonly keys: ReadonlySet<string> }>(ENVIRONMENT_KEYS_BAG_KEY)
    if (published === undefined) {
      return
    }
    for (const key of published.keys) {
      environmentInstalledKeys.add(key)
    }
  }

  const vitestPackageJsonPath = (): string => createRequire(sandboxBase).resolve('vitest/package.json')

  const vitestEntry = (): string => import.meta.resolve('vitest', pathToFileURL(vitestPackageJsonPath()).href)

  let vitestNamespace: VitestModuleNamespace | undefined
  const resolveVitest = (): VitestModuleNamespace => {
    const cached = vitestNamespace
    if (cached !== undefined) {
      return cached
    }
    throw new Error('the vitest module namespace was not preloaded before the session ran')
  }

  const host: VmPluginHost = {
    sandboxWorkingDirectory: options.sandboxWorkingDirectory,
    options,
    state: bag,
    resolveVitest,
    resolveVitestModule: (specifier: string): string => createRequire(sandboxBase).resolve(specifier),
    importFile: (file: string, salt: string) => {
      if (activeRegistry !== undefined) {
        activeRegistry.files.current = ownerOfSalt(salt) ?? file
      }
      saltOwners.set(salt, file)
      return nativeImport(fileUrlFor(file, salt)).then(() => undefined)
    },
  }

  const stage = <K extends VmStageName>(name: K, ...args: VmStageArgs[K]): Effect.Effect<void> =>
    Effect.promise(() => runStage(plugins, name, ...args))

  const globalsFor = (file: string): VmGlobals => {
    let merged: VmGlobals = {}
    for (const plugin of plugins) {
      const values = plugin.globals?.(file, host)
      if (values !== undefined) {
        merged = { ...merged, ...values }
      }
    }
    return merged
  }

  const discoveredFiles = (): readonly string[] | undefined =>
    bag.read<VmDiscoveredTestFiles>(VM_TEST_FILES_BAG_KEY)?.files

  const fileContextFor = (file: string, saltOf: (file: string) => string): VmFileContext => {
    const salt = saltOf(file)
    return { file, salt, url: fileUrlFor(file, salt) }
  }

  const graphContextFor = (loaded: LoadedGraph): VmGraphContext => ({
    registry: loaded.registry,
    files: loaded.files,
  })

  const testContextFor = (ref: DrainTestRef, runKind: VmRunRequest['kind']): VmTestContext => ({
    id: ref.id,
    name: ref.name,
    file: ref.file,
    runKind,
  })

  const buildGraph = (files: readonly string[]): Effect.Effect<LoadedGraphBuild | RefusedGraphBuild> => {
    if (entryRefusal !== undefined) {
      return Effect.succeed({ refusal: entryRefusal })
    }
    const registry = createRegistry()
    activeRegistry = registry
    const api = createHarnessApi(registry)
    installedApi = api
    let vitest: VitestModuleNamespace
    try {
      vitest = host.resolveVitest()
    } catch (cause) {
      return Effect.succeed({ refusal: errorText(cause) })
    }
    const runtime = host.state.read<VmVitestRuntime>(VM_VITEST_BAG_KEY)
    const base: VmRunnerGlobalState = {
      api,
      expect: vitest.createExpect === undefined
        ? guardedExpect(vitest.expect)
        : guardedExpect(vitest.expect, vitest.createExpect),
      vi: vitest.vi === undefined ? undefined : guardedVi(vitest.vi),
      effectVitest: {
        it: makeEffectMethods({
          api: api.it,
          describe: api.describe,
          hooks: api.hooks,
          tests: registry.tests,
        }),
      },
      projectConfig: undefined,
      provided: {},
    }

    return Effect.gen(function*() {
      yield* stage('beforeGraphLoad', { registry, files }, host)
      if (isolate) {
        baselineGlobals = snapshotGlobals()
        baselineGlobalSymbols = snapshotGlobalSymbols()
        fileOverlays.clear()
      }

      const runSalt = String(saltCounter += 1)
      const fileSalts: string[] = []
      for (const [index] of files.entries()) {
        fileSalts.push(isolate ? `${runSalt}-${index}` : runSalt)
      }
      const saltOf = (file: string): string => fileSalts[files.indexOf(file)] ?? runSalt
      saltOwners.clear()
      for (const file of files) {
        saltOwners.set(saltOf(file), file)
      }
      let failure: RunFailure | undefined
      for (const file of files) {
        const context = fileContextFor(file, saltOf)
        registry.files.current = file
        registry.frames.current = []
        const provided: VmRunnerGlobalState['provided'] = { ...runtime?.projectFor(file).provide }
        registry.provided.current = provided
        writeGlobalState({ ...base, provided, ...globalsFor(file) })
        const importable: true | RefusedGraphBuild = yield* Effect.tryPromise({
          try: () =>
            runStage(plugins, 'beforeFileImport', context, host).then(() => {
              absorbEnvironmentKeys()
              return true as const
            }),
          catch: (caught) => ({ thrown: caught instanceof Error ? caught : new Error(errorText(caught)) }),
        }).pipe(
          Effect.catch((stageFailure: { readonly thrown: Error }) => {
            const thrown: Error = stageFailure.thrown
            return Effect.succeed({ refusal: errorText(thrown) } satisfies RefusedGraphBuild)
          }),
        )
        if (importable !== true) {
          return importable satisfies RefusedGraphBuild
        }
        const outcome = yield* Effect.promise(() =>
          nativeImport(context.url).then(
            () => undefined,
            <A = unknown>(cause: A) => ({ cause }),
          )
        )
        if (outcome !== undefined) {
          const reported = runFailureFor(file, outcome.cause)
          const vitestRefusal = vitestUnresolvedRefusalFor(options.sandboxWorkingDirectory, outcome.cause)
          if (vitestRefusal !== undefined || reported.fatal) {
            return { refusal: vitestRefusal ?? reported.message } satisfies RefusedGraphBuild
          }
          failure ??= reported
        }
        const preDeactivateOverlay = isolate && baselineGlobals !== undefined && baselineGlobalSymbols !== undefined
          ? overlayEntriesOf(baselineGlobals, baselineGlobalSymbols, EMPTY_EXCLUDED_KEYS)
          : undefined
        const afterImport: true | RefusedGraphBuild = yield* Effect.promise(() =>
          runStage(plugins, 'afterFileImport', context, host).then(
            () => true as const,
            (cause: Error) => {
              const reported = runFailureFor(file, cause)
              if (reported.fatal) {
                return { refusal: reported.message } satisfies RefusedGraphBuild
              }
              failure ??= reported
              return true as const
            },
          )
        )
        if (afterImport !== true) {
          return afterImport satisfies RefusedGraphBuild
        }
        if (preDeactivateOverlay !== undefined) {
          fileOverlays.set(file, preDeactivateOverlay)
          restoreBaseline(preDeactivateOverlay.restore)
        }
        const collectFailure = registry.collectFailures.get(file)
        if (collectFailure !== undefined && failure === undefined) {
          failure = { file, message: collectFailure, fatal: false }
        }
      }
      return { graph: { registry, files, saltOf }, failure }
    })
  }

  const loadErrorTest = (failure: RunFailure, timeSpentMs: number): VmTestResult => ({
    id: testIdFor(options.sandboxWorkingDirectory, failure.file, 'load error'),
    name: `${failure.file} (load error)`,
    status: 'failed',
    failureMessage: failure.message,
    timeSpentMs,
  })

  const respondWith = (
    loaded: LoadedGraph,
    drained: DrainOutcome,
    failure: RunFailure | undefined,
    request: VmRunRequest,
    namespace: StrykerNamespace,
  ): VmRunResponse => {
    if (drained.kind === 'timeout') {
      return { status: 'timeout' }
    }
    const drainedElapsed = drained.tests.reduce((total, test) => total + test.timeSpentMs, 0)
    if (loaded.registry.tests.length === 0) {
      if (failure === undefined) {
        return { status: 'init-failed', message: ZERO_TESTS_MESSAGE }
      }
      return { status: 'complete', tests: [loadErrorTest(failure, drainedElapsed)] }
    }
    const tests: VmTestResult[] = drained.tests.map((test) => {
      const base: VmTestResult = {
        id: testIdFor(options.sandboxWorkingDirectory, test.file, test.fullName),
        name: test.fullName,
        status: test.status,
        timeSpentMs: test.timeSpentMs,
      }
      return test.status === 'failed' ? { ...base, failureMessage: test.failureMessage ?? '' } : base
    })
    if (failure !== undefined) {
      tests.push(loadErrorTest(failure, 0))
    }
    const rawCoverage: VmMutantCoverage | undefined = request.kind === 'dry' ? readMutantCoverage(namespace) : undefined
    const mutantCoverage: VmMutantCoverage | undefined = rawCoverage === undefined
      ? undefined
      : {
        static: rawCoverage.static,
        perTest: Object.fromEntries(
          Object.entries(rawCoverage.perTest).map(([testId, hits]) => [
            relativeTestIdOf(options.sandboxWorkingDirectory, testId),
            hits,
          ]),
        ),
      }
    return mutantCoverage === undefined
      ? { status: 'complete', tests }
      : { status: 'complete', tests, mutantCoverage }
  }

  const executeRun = (request: VmRunRequest): Effect.Effect<VmRunResponse> =>
    Effect.gen(function*() {
      const namespace = hostStrykerNamespace()
      const previousArmed = readArmedMutant(namespace)
      const restoreArmed = Effect.sync(() => writeArmedMutant(namespace, previousArmed))

      return yield* Effect.gen(function*() {
        armMutant(namespace, request.kind === 'mutant' ? request.activeMutantId : undefined, request.hitLimit)
        if (request.kind === 'dry') {
          resetMutantCoverage(namespace)
        }
        const absoluteFilter = request.testFilter?.map((testId) =>
          absoluteTestIdOf(options.sandboxWorkingDirectory, testId)
        )

        const reusable = request.kind !== 'mutant' &&
            request.reloadEnvironment === false &&
            graph !== undefined &&
            graphCoversFilter(graph.files, absoluteFilter)
          ? graph
          : undefined
        let loaded = reusable
        let failure: RunFailure | undefined
        if (loaded === undefined) {
          const declared = options.testFiles.length > 0 ? options.testFiles : activeFiles
          const candidates = runnableFilesOf(declared, discoveredFiles())
          const files = ownedFilesOf(candidates, absoluteFilter)
          if (files.length === 0) {
            return { status: 'init-failed', message: ZERO_TESTS_MESSAGE } satisfies VmRunResponse
          }
          const previous = graph
          const built = yield* buildGraph(files)
          if ('refusal' in built) {
            return { status: 'init-failed', message: built.refusal } satisfies VmRunResponse
          }
          graph = built.graph
          activeFiles = files
          loaded = built.graph
          failure = built.failure
          if (previous !== undefined) {
            yield* stage('disposeGraph', graphContextFor(previous), host)
          }
        }

        const saltOf = loaded.saltOf
        const applyFileOverlay = (file: string): void => {
          if (!isolate) {
            return
          }
          const captured = fileOverlays.get(file)
          if (captured !== undefined) {
            restoreBaseline(captured.restore)
            applyOverlay(captured.overlay)
          }
        }
        const recaptureFileOverlay = (file: string): void => {
          if (!isolate || baselineGlobals === undefined || baselineGlobalSymbols === undefined) {
            return
          }
          const captured = overlayEntriesOf(baselineGlobals, baselineGlobalSymbols, environmentInstalledKeys)
          fileOverlays.set(file, captured)
          restoreBaseline(captured.restore)
        }
        const runtime = host.state.read<VmVitestRuntime>(VM_VITEST_BAG_KEY)
        const drained = yield* Effect.promise(() =>
          executeDrainRegistry(loaded.registry, request.timeoutMs, {
            testFilter: absoluteFilter,
            allowOnlyFor: (file) => runtime?.projectFor(file).allowOnly ?? false,
            configFor: (file) => runtime?.projectFor(file),
            beforeFileRun: (file) => {
              applyFileOverlay(file)
              return runStage(plugins, 'beforeFileRun', fileContextFor(file, saltOf), host).then(() => {
                absorbEnvironmentKeys()
              })
            },
            afterFileRun: (file) => {
              const done = runStage(plugins, 'afterFileRun', fileContextFor(file, saltOf), host)
              return Promise.resolve(done).then(() => {
                recaptureFileOverlay(file)
              })
            },
            beforeTest: (ref) => runStage(plugins, 'beforeTest', testContextFor(ref, request.kind), host),
            afterTest: (ref, outcome: DrainTestOutcome) =>
              runStage(plugins, 'afterTest', testContextFor(ref, request.kind), outcome, host),
          })
        )

        const response = respondWith(loaded, drained, failure, request, namespace)
        const afterRun: VmRunContext = { request, graph: graphContextFor(loaded), response }
        yield* stage('afterRun', afterRun, host)
        return response
      }).pipe(Effect.ensuring(restoreArmed))
    })

  const run = (request: VmRunRequest): Promise<VmRunResponse> => {
    const next: Promise<VmRunResponse> = queue.then(
      () => Effect.runPromise(executeRun(request)),
      () => Effect.runPromise(executeRun(request)),
    )
    queue = next.then(
      () => undefined,
      () => undefined,
    )
    return next
  }

  const dispose = (): Promise<void> =>
    Effect.runPromise(
      Effect.gen(function*() {
        if (disposed) {
          return
        }
        disposed = true
        if (graph !== undefined) {
          yield* stage('disposeGraph', graphContextFor(graph), host)
          graph = undefined
        }
        for (const plugin of [...plugins].reverse()) {
          yield* Effect.promise(() => Promise.resolve(plugin.dispose?.(host)))
        }
        restoreExit?.()
        restoreHostWorkerState()
        const installed = readGlobalState()
        if (installed === undefined || installed.api === installedApi) {
          writeGlobalState(undefined)
        }
        deactivateSandbox()
        uninstallInterception()
      }),
    )

  return Effect.runPromise(
    Effect.gen(function*() {
      const entry = resolveSandboxEntry()
      if (entry === undefined) {
        entryRefusal = vitestMissingMessage(options.sandboxWorkingDirectory)
      }
      restoreExit = installExitGuard(options.sandboxWorkingDirectory)
      installInterception(globalThis.process.getBuiltinModule('node:module'), {
        host,
        plugins,
      })
      activateSandbox(prefix)
      if (entry !== undefined) {
        vitestNamespace = yield* Effect.promise(() =>
          nativeImport(entry).then(
            (namespace) => namespace as VitestModuleNamespace,
            <A = unknown>(cause: A) => {
              throw new Error(`the vitest module could not be loaded for the session: ${errorText(cause)}`)
            },
          )
        )
      }
      if (entryRefusal === undefined) {
        yield* stage('init', host)
      }
      return { run, dispose }
    }),
  )
}
