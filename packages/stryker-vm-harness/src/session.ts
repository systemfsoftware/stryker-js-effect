import * as Effect from 'effect/Effect'
import { dual } from 'effect/Function'
import * as HashMap from 'effect/HashMap'
import * as Option from 'effect/Option'

import { dispatchingExpect, guardedExpect, guardedVi } from './assertions.handle.js'
import {
  type DrainRunOptions,
  type DrainTestOutcome,
  type DrainTestRef,
  executeDrainRegistry,
} from './drain-executor.cell.js'
import type { DrainOutcome } from './drain-registry.workflow.js'
import { makeEffectMethods } from './effect-adapter.handle.js'
import { ENVIRONMENT_KEYS_BAG_KEY } from './environments/environment-activation.js'
import { sameDescriptor } from './environments/global-descriptors.js'
import { createHarnessApi } from './harness-api.handle.js'
import { STATE_KEY } from './harness-sources.handle.js'
import { nativeImport } from './native-import.handle.js'
import { builtinPlugins } from './plugins/index.js'
import { createRegistry } from './registry.handle.js'
import type { HarnessApi, TestRegistry } from './registry.schema.js'
import {
  activateSandbox,
  deactivateSandbox,
  installInterception,
  uninstallInterception,
} from './sandbox-interception.handle.js'
import { readGlobalState, restoreHostWorkerState, workerStateOf, writeGlobalState } from './sandbox-state.handle.js'
import type { VmRunnerGlobalState } from './sandbox.schema.js'
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
import { realpath } from './vitest-host/node-builtins.js'
import { VM_VITEST_BAG_KEY, type VmVitestRuntime } from './vitest-host/runtime.js'
import type {
  VmMutantCoverage,
  VmRunRequest,
  VmRunResponse,
  VmSessionOptions,
  VmTestResult,
} from './vm-protocol.schema.js'
import { isVmSessionOptions } from './vm-protocol.schema.js'

const startsWithSessionOptions = (args: IArguments): boolean => isVmSessionOptions(args[0])

const moduleBuiltin = globalThis.process.getBuiltinModule('node:module')
const urlBuiltin = globalThis.process.getBuiltinModule('node:url')

const { createRequire } = moduleBuiltin
const { pathToFileURL } = urlBuiltin

const canonicalSessionOptions = (options: VmSessionOptions): VmSessionOptions => ({
  ...options,
  sandboxWorkingDirectory: realpath(options.sandboxWorkingDirectory),
  testFiles: options.testFiles.map(realpath),
})

const ZERO_TESTS_MESSAGE =
  'The "vm" test runner ran zero tests. Set the "testFiles" option so it knows which files to load, or use testRunner "vitest" or "command".'

const MISSING_VITEST_SPECIFIER = "Cannot find package 'vitest"

const MODULE_NOT_FOUND_CODE = 'ERR_MODULE_NOT_FOUND'

const PARSE_ERROR_MARKER = '[PARSE_ERROR]'

type AnyDecoded<A = unknown> = A

interface RunFailure {
  readonly file: string
  readonly message: string
  readonly fatal: boolean
}

interface TestIdParts {
  readonly file: string
  readonly name: string
}

interface OverlayEntries {
  readonly overlay: Map<string | symbol, PropertyDescriptor>
  readonly restore: Map<string | symbol, PropertyDescriptor | undefined>
}

interface OverlayBaselines {
  readonly globals: ReadonlyMap<string, PropertyDescriptor>
  readonly symbols: ReadonlyMap<symbol, PropertyDescriptor>
}

type GlobalOverlay = ReadonlyMap<string | symbol, PropertyDescriptor>
type GlobalBaseline = ReadonlyMap<string | symbol, PropertyDescriptor | undefined>

interface LoadedGraph {
  readonly registry: TestRegistry
  readonly files: readonly string[]
  readonly saltOf: (file: string) => string
}

export interface LoadedGraphBuild {
  readonly graph: LoadedGraph
  readonly failure: RunFailure | undefined
}

export interface RefusedGraphBuild {
  readonly refusal: string
}

export interface VmSession {
  readonly run: (request: VmRunRequest) => Promise<VmRunResponse>
  readonly dispose: () => Promise<void>
}

type DrainedCompletion = Extract<DrainOutcome, { readonly kind: 'complete' }>
type TimedOutDrain = Extract<DrainOutcome, { readonly kind: 'timeout' }>
type DrainedTest = DrainedCompletion['tests'][number]

type ImportOutcome = { readonly cause: AnyDecoded } | undefined

interface ImportFailureReport {
  readonly refusal: string | undefined
  readonly failure: RunFailure | undefined
}

interface FileLoad {
  refusal: string | undefined
  failure: RunFailure | undefined
}

interface LoadState {
  refusal: string | undefined
  readonly loads: FileLoad[]
}

interface GraphLoadDeps {
  readonly registry: TestRegistry
  readonly base: VmRunnerGlobalState
  readonly runtime: VmVitestRuntime | undefined
}

interface FileLoadDeps extends GraphLoadDeps {
  readonly saltOf: (file: string) => string
}

type VitestResolution = { readonly vitest: VitestModuleNamespace } | RefusedGraphBuild

interface RunReady {
  readonly kind: 'ready'
  readonly loaded: LoadedGraph
  readonly failure: RunFailure | undefined
}

interface RunRefused {
  readonly kind: 'refused'
  readonly response: VmRunResponse
}

type RunPreparation = RunReady | RunRefused

interface ResponseContext {
  readonly sandboxWorkingDirectory: string
  readonly loaded: LoadedGraph
  readonly failure: RunFailure | undefined
  readonly request: VmRunRequest
  readonly namespace: StrykerNamespace
}

const isObjectValue = (value: AnyDecoded): value is object => typeof value === 'object' && value !== null

const isStringValue = (value: AnyDecoded): value is string => typeof value === 'string'

const isNonEmptyStringValue = (value: AnyDecoded): value is string => typeof value === 'string' && value.length > 0

const isErrorValue = (value: AnyDecoded): value is Error => value instanceof Error

const isRequestedBagValue = <A extends object>(value: AnyDecoded): value is A => isObjectValue(value)

const objectOf = <A = unknown>(value: A): Option.Option<object> => Option.liftPredicate(isObjectValue)(value)

const reflectedOf = (target: object, key: string): AnyDecoded => {
  const reflected: AnyDecoded = Reflect.get(target, key)
  return reflected
}

const hasMember = (target: object, key: string): boolean => Reflect.has(target, key)

const carriedMemberOf = (target: object, key: string): AnyDecoded =>
  hasMember(target, key) ? reflectedOf(target, key) : undefined

const stringMemberOf = (target: object, key: string): string | undefined =>
  Option.getOrUndefined(Option.liftPredicate(isStringValue)(carriedMemberOf(target, key)))

const messageOf = <A = unknown>(value: A): string | undefined =>
  Option.getOrUndefined(Option.map(objectOf(value), (held) => stringMemberOf(held, 'message')))

const errorMessageOf = <A = unknown>(error: A): string | undefined =>
  Option.getOrUndefined(Option.map(Option.liftPredicate(isErrorValue)(error), (held) => held.message))

const carriedTextOf = <A = unknown>(error: A): string | undefined => errorMessageOf(error) ?? messageOf(error)

const errorText = <A = unknown>(error: A): string =>
  carriedTextOf(error) ?? new Error('in-memory runner failure', { cause: error }).message

const isModuleNotFoundError = <A = unknown>(error: A): boolean =>
  isObjectValue(error) && carriedMemberOf(error, 'code') === MODULE_NOT_FOUND_CODE

const isParseError = <A = unknown>(error: A): boolean => errorMessageOf(error)?.includes(PARSE_ERROR_MARKER) === true

const isUnresolvableImport = <A = unknown>(error: A): boolean => isModuleNotFoundError(error) || isParseError(error)

const isInitFailure = <A = unknown>(error: A): boolean =>
  error instanceof SyntaxError ? true : isUnresolvableImport(error)

const runFailureFor = <A = unknown>(file: string, cause: A): RunFailure => {
  const fatal = isInitFailure(cause)
  const message = fatal
    ? `Could not load "${file}" for the in-memory runner: ${errorText(cause)}`
    : errorText(cause)
  return { file, message, fatal }
}

const vitestMissingMessage = (sandbox: string): string =>
  `Could not resolve the vitest package from the sandbox working directory "${sandbox}". A sandbox must be able to load vitest: install it there, or link a node_modules directory that has it.`

const unresolvedVitestRefusal = (sandbox: string, cause: AnyDecoded): string | undefined =>
  errorText(cause).includes(MISSING_VITEST_SPECIFIER) ? vitestMissingMessage(sandbox) : undefined

const vitestUnresolvedRefusalFor = <A = unknown>(sandbox: string, cause: A): string | undefined =>
  isModuleNotFoundError(cause) ? unresolvedVitestRefusal(sandbox, cause) : undefined

const testIdPartsOf = (testId: string): TestIdParts | undefined => {
  const at = testId.indexOf('#')
  return at === -1 ? undefined : { file: testId.slice(0, at), name: testId.slice(at + 1) }
}

const fileOfTestId = (testId: string): string | undefined => {
  const at = testId.indexOf('#')
  return at === -1 ? undefined : testId.slice(0, at)
}

const directoryBaseOf = (directory: string): string => directory.endsWith('/') ? directory : `${directory}/`

const relativePathOf = (file: string, base: string): string =>
  file.startsWith(base) ? file.slice(base.length).replace(/^\/+/, '') : file

const portablePathOf = (file: string): string => file.replaceAll('\\', '/')

const testIdFor = (sandboxWorkingDirectory: string, file: string, name: string): string =>
  `${portablePathOf(relativePathOf(file, directoryBaseOf(sandboxWorkingDirectory)))}#${name}`

const isAbsoluteFile = (file: string): boolean => file.startsWith('/') || /^[A-Za-z]:[\\/]/.test(file)

const absolutePartsOf = (sandboxWorkingDirectory: string, parts: TestIdParts): string =>
  isAbsoluteFile(parts.file)
    ? `${realpath(parts.file)}#${parts.name}`
    : `${directoryBaseOf(sandboxWorkingDirectory)}${parts.file.replace(/^\/+/, '')}#${parts.name}`

const absoluteTestIdOf = (sandboxWorkingDirectory: string, testId: string): string => {
  const parts = testIdPartsOf(testId)
  return parts === undefined ? testId : absolutePartsOf(sandboxWorkingDirectory, parts)
}

const relativeTestIdOf = (sandboxWorkingDirectory: string, testId: string): string => {
  const parts = testIdPartsOf(testId)
  return parts === undefined
    ? testId
    : `${portablePathOf(relativePathOf(parts.file, directoryBaseOf(sandboxWorkingDirectory)))}#${parts.name}`
}

const isFilterActive = (testFilter: readonly string[] | undefined): boolean =>
  testFilter !== undefined && testFilter.length > 0

const activeFilterOf = (testFilter: readonly string[] | undefined): readonly string[] | undefined =>
  isFilterActive(testFilter) ? testFilter : undefined

const isLoadedTestId = (loaded: ReadonlySet<string>, testId: string): boolean =>
  Option.exists(Option.fromNullishOr(fileOfTestId(testId)), (file) => loaded.has(file))

const coversFilter = (loaded: ReadonlySet<string>, testFilter: readonly string[]): boolean =>
  testFilter.every((testId) => isLoadedTestId(loaded, testId))

const graphCoversFilter = (files: readonly string[], testFilter: readonly string[] | undefined): boolean =>
  Option.match(Option.fromNullishOr(activeFilterOf(testFilter)), {
    onNone: () => true,
    onSome: (tests) => coversFilter(new Set(files), tests),
  })

const addFileOwner = (owners: Set<string>, testId: string): void => {
  const file = fileOfTestId(testId)
  if (file !== undefined) {
    owners.add(file)
  }
}

const ownersOf = (testFilter: readonly string[]): ReadonlySet<string> => {
  const owners = new Set<string>()
  for (const testId of testFilter) {
    addFileOwner(owners, testId)
  }
  return owners
}

const ownedAmong = (testFiles: readonly string[], owners: ReadonlySet<string>): readonly string[] => {
  const owned = testFiles.filter((file) => owners.has(file))
  return owned.length > 0 ? owned : testFiles
}

const ownedFilesOf = (testFiles: readonly string[], testFilter: readonly string[] | undefined): readonly string[] =>
  Option.match(Option.fromNullishOr(activeFilterOf(testFilter)), {
    onNone: () => testFiles,
    onSome: (tests) => ownedAmong(testFiles, ownersOf(tests)),
  })

const runnableFilesOf = (declared: readonly string[], discovered: readonly string[] | undefined): readonly string[] =>
  declared.length > 0 ? declared : Option.getOrElse(Option.fromNullishOr(discovered), () => declared)

const snapshotGlobals = (): ReadonlyMap<string, PropertyDescriptor> =>
  new Map(Object.entries(Object.getOwnPropertyDescriptors(globalThis)))

const descriptorEntryOf = (symbol: symbol): ReadonlyArray<readonly [symbol, PropertyDescriptor]> => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, symbol)
  return descriptor === undefined ? [] : [[symbol, descriptor]]
}

const snapshotGlobalSymbols = (): ReadonlyMap<symbol, PropertyDescriptor> =>
  new Map(Object.getOwnPropertySymbols(globalThis).flatMap(descriptorEntryOf))

const PROTECTED_GLOBAL_KEYS: Record<string, true> = {
  __stryker__: true,
  __vitest_worker__: true,
}

const PROTECTED_GLOBAL_SYMBOLS: ReadonlySet<symbol> = new Set([STATE_KEY])

const EMPTY_EXCLUDED_KEYS: ReadonlySet<string> = new Set()

const emptyOverlayEntries = (): OverlayEntries => ({ overlay: new Map(), restore: new Map() })

const isProtectedKey = (key: string, excludedKeys: ReadonlySet<string>): boolean =>
  PROTECTED_GLOBAL_KEYS[key] === true || excludedKeys.has(key)

const isUnchangedKey = (
  key: string,
  descriptor: PropertyDescriptor,
  baseline: ReadonlyMap<string, PropertyDescriptor>,
  excludedKeys: ReadonlySet<string>,
): boolean => isProtectedKey(key, excludedKeys) || sameDescriptor(baseline.get(key), descriptor)

const overlayKeyIfChanged = (
  key: string,
  descriptor: PropertyDescriptor,
  baseline: ReadonlyMap<string, PropertyDescriptor>,
  excludedKeys: ReadonlySet<string>,
  entries: OverlayEntries,
): void => {
  if (!isUnchangedKey(key, descriptor, baseline, excludedKeys)) {
    entries.overlay.set(key, descriptor)
    entries.restore.set(key, baseline.get(key))
  }
}

const isUntouchedKey = (key: string, current: ReadonlyMap<string, PropertyDescriptor>): boolean =>
  current.has(key) || PROTECTED_GLOBAL_KEYS[key] === true

const needsRestoreEntry = (
  key: string,
  current: ReadonlyMap<string, PropertyDescriptor>,
  restore: ReadonlyMap<string | symbol, PropertyDescriptor | undefined>,
): boolean => !isUntouchedKey(key, current) && !restore.has(key)

const restoreDroppedKeyIfNeeded = (
  key: string,
  baseline: ReadonlyMap<string, PropertyDescriptor>,
  current: ReadonlyMap<string, PropertyDescriptor>,
  entries: OverlayEntries,
): void => {
  if (needsRestoreEntry(key, current, entries.restore)) {
    entries.restore.set(key, baseline.get(key))
  }
}

const isUnchangedSymbol = (
  symbol: symbol,
  descriptor: PropertyDescriptor,
  baselineSymbols: ReadonlyMap<symbol, PropertyDescriptor>,
): boolean => PROTECTED_GLOBAL_SYMBOLS.has(symbol) || sameDescriptor(baselineSymbols.get(symbol), descriptor)

const overlaySymbolIfChanged = (
  symbol: symbol,
  descriptor: PropertyDescriptor,
  baselineSymbols: ReadonlyMap<symbol, PropertyDescriptor>,
  entries: OverlayEntries,
): void => {
  if (!isUnchangedSymbol(symbol, descriptor, baselineSymbols)) {
    entries.overlay.set(symbol, descriptor)
    entries.restore.set(symbol, baselineSymbols.get(symbol))
  }
}

const collectKeyOverlays = (
  current: ReadonlyMap<string, PropertyDescriptor>,
  baseline: ReadonlyMap<string, PropertyDescriptor>,
  excludedKeys: ReadonlySet<string>,
  entries: OverlayEntries,
): void => {
  for (const [key, descriptor] of current) {
    overlayKeyIfChanged(key, descriptor, baseline, excludedKeys, entries)
  }
}

const collectMissingBaselineKeys = (
  baseline: ReadonlyMap<string, PropertyDescriptor>,
  current: ReadonlyMap<string, PropertyDescriptor>,
  entries: OverlayEntries,
): void => {
  for (const key of baseline.keys()) {
    restoreDroppedKeyIfNeeded(key, baseline, current, entries)
  }
}

const collectSymbolOverlays = (
  currentSymbols: ReadonlyMap<symbol, PropertyDescriptor>,
  baselineSymbols: ReadonlyMap<symbol, PropertyDescriptor>,
  entries: OverlayEntries,
): void => {
  for (const [symbol, descriptor] of currentSymbols) {
    overlaySymbolIfChanged(symbol, descriptor, baselineSymbols, entries)
  }
}

const overlayEntriesOf = (
  baseline: ReadonlyMap<string, PropertyDescriptor>,
  baselineSymbols: ReadonlyMap<symbol, PropertyDescriptor>,
  excludedKeys: ReadonlySet<string>,
): OverlayEntries => {
  const current = snapshotGlobals()
  const currentSymbols = snapshotGlobalSymbols()
  const entries = emptyOverlayEntries()
  collectKeyOverlays(current, baseline, excludedKeys, entries)
  collectMissingBaselineKeys(baseline, current, entries)
  collectSymbolOverlays(currentSymbols, baselineSymbols, entries)
  return entries
}

const applyOverlay = (overlay: GlobalOverlay): void => {
  for (const [key, descriptor] of overlay) {
    Object.defineProperty(globalThis, key, descriptor)
  }
}

const restoreGlobal = (key: string | symbol, original: PropertyDescriptor | undefined): void => {
  if (original === undefined) {
    Reflect.deleteProperty(globalThis, key)
    return
  }
  Object.defineProperty(globalThis, key, original)
}

const restoreBaseline = (restore: GlobalBaseline): void => {
  for (const [key, original] of restore) {
    restoreGlobal(key, original)
  }
}

const workerFilepathOf = (): AnyDecoded =>
  Option.getOrUndefined(
    Option.map(Option.fromNullishOr(workerStateOf()), (state) => reflectedOf(state, 'filepath')),
  )

const exitFilepathOf = (sandboxWorkingDirectory: string): string =>
  Option.getOrElse(
    Option.liftPredicate(isNonEmptyStringValue)(workerFilepathOf()),
    () => sandboxWorkingDirectory,
  )

const exitGuardMessage = (code: number | undefined, sandboxWorkingDirectory: string): string =>
  `process.exit unexpectedly called with "${String(code)}" (test file: ${exitFilepathOf(sandboxWorkingDirectory)})`

const installExitGuard = (sandboxWorkingDirectory: string): () => void => {
  const runner = globalThis.process
  const original = runner.exit.bind(runner)
  const guarded: typeof runner.exit = (code?: number): never => {
    throw new Error(exitGuardMessage(code, sandboxWorkingDirectory))
  }
  runner.exit = guarded
  return () => {
    if (runner.exit === guarded) {
      runner.exit = original
    }
  }
}

let saltCounter = 0

const createSession = (
  received: VmSessionOptions,
  plugins: readonly VmSessionPlugin[],
): Promise<VmSession> => {
  const options = canonicalSessionOptions(received)
  const prefix = pathToFileURL(options.sandboxWorkingDirectory).href.replace(/\/?$/, '/')
  const isolate = options.isolate ?? true
  const saltOwners = new Map<string, string>()
  const fileOverlays = new Map<string, OverlayEntries>()
  const environmentInstalledKeys = new Set<string>()
  const sandboxBase = new URL('noop.js', `${prefix}`)
  let graph: LoadedGraph | undefined
  let installedApi: HarnessApi | undefined
  let restoreExit: (() => void) | undefined
  let disposed = false
  let queue: Promise<void> = Promise.resolve()
  let activeRegistry: TestRegistry | undefined
  let baselineGlobals: ReadonlyMap<string, PropertyDescriptor> | undefined
  let baselineGlobalSymbols: ReadonlyMap<symbol, PropertyDescriptor> | undefined
  let entryRefusal: string | undefined
  let vitestNamespace: VitestModuleNamespace | undefined
  let bagStore = HashMap.empty<string, AnyDecoded>()

  const fileUrlFor = (file: string, salt: string): string => `${pathToFileURL(file).href}?salt=${salt}`

  const vitestPackageJsonPath = (): string => createRequire(sandboxBase).resolve('vitest/package.json')

  const vitestEntry = (): string => import.meta.resolve('vitest', pathToFileURL(vitestPackageJsonPath()).href)

  const resolveSandboxEntry = (): string | undefined => {
    try {
      return vitestEntry()
    } catch {
      return undefined
    }
  }

  const bag: VmPluginBag = {
    read: <A extends object>(key: string): A | undefined =>
      Option.getOrUndefined(
        Option.flatMap(
          HashMap.get(bagStore, key),
          (held) => Option.liftPredicate(isRequestedBagValue<A>)(held),
        ),
      ),
    write: <A extends object>(key: string, value: A): void => {
      bagStore = HashMap.set(bagStore, key, value)
    },
  }

  const resolveVitest = (): VitestModuleNamespace => {
    const cached = vitestNamespace
    if (cached !== undefined) {
      return cached
    }
    throw new Error('the vitest module namespace was not preloaded before the session ran')
  }

  const vitestRuntimeOf = (): VmVitestRuntime | undefined => bag.read<VmVitestRuntime>(VM_VITEST_BAG_KEY)

  const environmentKeysOf = (): { readonly keys: ReadonlySet<string> } | undefined =>
    bag.read<{ readonly keys: ReadonlySet<string> }>(ENVIRONMENT_KEYS_BAG_KEY)

  const discoveredFiles = (): readonly string[] | undefined =>
    bag.read<VmDiscoveredTestFiles>(VM_TEST_FILES_BAG_KEY)?.files

  const absorbEnvironmentKeys = (): void => {
    environmentKeysOf()?.keys.forEach((key) => {
      environmentInstalledKeys.add(key)
    })
  }

  const ownerOfSalt = (salt: string): string | undefined => saltOwners.get(salt)

  const ownerFileOf = (salt: string, file: string): string => ownerOfSalt(salt) ?? file

  const setActiveRegistryFile = (file: string): void => {
    if (activeRegistry !== undefined) {
      activeRegistry.files.current = file
    }
  }

  const host: VmPluginHost = {
    sandboxWorkingDirectory: options.sandboxWorkingDirectory,
    options,
    state: bag,
    resolveVitest,
    resolveVitestModule: (specifier: string): string => createRequire(sandboxBase).resolve(specifier),
    importFile: (file: string, salt: string) => {
      setActiveRegistryFile(ownerFileOf(salt, file))
      saltOwners.set(salt, file)
      return nativeImport(fileUrlFor(file, salt)).then(() => undefined)
    },
  }

  const stage = <K extends VmStageName>(name: K, ...args: VmStageArgs[K]): Effect.Effect<void> =>
    Effect.promise(() => runStage(plugins, name, ...args))

  const pluginGlobalsOf = (plugin: VmSessionPlugin, file: string): VmGlobals =>
    Option.getOrElse(Option.fromNullishOr(plugin.globals?.(file, host)), () => ({}))

  const globalsFor = (file: string): VmGlobals => {
    const merged: VmGlobals = {}
    for (const plugin of plugins) {
      Object.assign(merged, pluginGlobalsOf(plugin, file))
    }
    return merged
  }

  const absoluteFilterOf = (request: VmRunRequest): readonly string[] | undefined =>
    request.testFilter?.map((testId) => absoluteTestIdOf(options.sandboxWorkingDirectory, testId))

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

  const providedGlobalsFor = (runtime: VmVitestRuntime | undefined, file: string): VmRunnerGlobalState['provided'] => ({
    ...runtime?.projectFor(file).provide,
  })

  const startFileLoad = (deps: GraphLoadDeps, file: string): void => {
    deps.registry.files.current = file
    deps.registry.frames.current = []
    const provided = providedGlobalsFor(deps.runtime, file)
    deps.registry.provided.current = provided
    writeGlobalState({ ...deps.base, provided, ...globalsFor(file) })
  }

  const preImportRefusalFor = (context: VmFileContext): Effect.Effect<string | undefined> =>
    Effect.promise(() =>
      runStage(plugins, 'beforeFileImport', context, host).then(
        () => {
          absorbEnvironmentKeys()
          return undefined
        },
        <A = unknown>(cause: A) => errorText(cause),
      )
    )

  const importOutcomeFor = (context: VmFileContext): Effect.Effect<ImportOutcome> =>
    Effect.promise(() =>
      nativeImport(context.url).then(
        () => undefined,
        <A = unknown>(cause: A) => ({ cause }),
      )
    )

  const isTerminalImportFailure = (vitestRefusal: string | undefined, reported: RunFailure): boolean =>
    vitestRefusal !== undefined || reported.fatal

  const terminalRefusalOf = (vitestRefusal: string | undefined, reported: RunFailure): string =>
    vitestRefusal ?? reported.message

  const reportForImportCause = (
    sandboxWorkingDirectory: string,
    file: string,
    cause: AnyDecoded,
  ): ImportFailureReport => {
    const reported = runFailureFor(file, cause)
    const vitestRefusal = vitestUnresolvedRefusalFor(sandboxWorkingDirectory, cause)
    return isTerminalImportFailure(vitestRefusal, reported)
      ? { refusal: terminalRefusalOf(vitestRefusal, reported), failure: undefined }
      : { refusal: undefined, failure: reported }
  }

  const emptyImportReport = (): ImportFailureReport => ({ refusal: undefined, failure: undefined })

  const importReportOf = (
    sandboxWorkingDirectory: string,
    file: string,
    imported: ImportOutcome,
  ): ImportFailureReport =>
    imported === undefined
      ? emptyImportReport()
      : reportForImportCause(sandboxWorkingDirectory, file, imported.cause)

  const afterImportReportFor = (file: string, cause: AnyDecoded): ImportFailureReport => {
    const reported = runFailureFor(file, cause)
    return reported.fatal
      ? { refusal: reported.message, failure: undefined }
      : { refusal: undefined, failure: reported }
  }

  const afterImportReport = (file: string, context: VmFileContext): Effect.Effect<ImportFailureReport> =>
    Effect.promise(() =>
      runStage(plugins, 'afterFileImport', context, host).then(
        emptyImportReport,
        <A = unknown>(cause: A) => afterImportReportFor(file, cause),
      )
    )

  const mergeFailure = (current: RunFailure | undefined, next: RunFailure | undefined): RunFailure | undefined =>
    current ?? next

  const collectFailureFor = (registry: TestRegistry, file: string): RunFailure | undefined => {
    const message = registry.collectFailures.get(file)
    return message === undefined ? undefined : { file, message, fatal: false }
  }

  const adoptOverlay = (file: string, overlay: OverlayEntries | undefined): void => {
    if (overlay !== undefined) {
      fileOverlays.set(file, overlay)
      restoreBaseline(overlay.restore)
    }
  }

  const applyCapturedOverlay = (captured: OverlayEntries | undefined): void => {
    if (captured !== undefined) {
      restoreBaseline(captured.restore)
      applyOverlay(captured.overlay)
    }
  }

  const applyFileOverlay = (file: string): void => {
    if (isolate) {
      applyCapturedOverlay(fileOverlays.get(file))
    }
  }

  const withSymbolBaselines = (globals: ReadonlyMap<string, PropertyDescriptor>): OverlayBaselines | undefined =>
    Option.match(Option.fromNullishOr(baselineGlobalSymbols), {
      onNone: () => undefined,
      onSome: (symbols) => ({ globals, symbols }),
    })

  const currentBaselines = (): OverlayBaselines | undefined =>
    Option.match(Option.fromNullishOr(baselineGlobals), {
      onNone: () => undefined,
      onSome: (globals) => withSymbolBaselines(globals),
    })

  const isolatedBaselines = (): OverlayBaselines | undefined => isolate ? currentBaselines() : undefined

  const capturedOverlay = (excludedKeys: ReadonlySet<string>): OverlayEntries | undefined => {
    const baselines = isolatedBaselines()
    return baselines === undefined
      ? undefined
      : overlayEntriesOf(baselines.globals, baselines.symbols, excludedKeys)
  }

  const recaptureFileOverlay = (file: string): void => {
    adoptOverlay(file, capturedOverlay(environmentInstalledKeys))
  }

  const applyImportReport = (load: FileLoad, report: ImportFailureReport): void => {
    load.refusal = report.refusal
    load.failure = mergeFailure(load.failure, report.failure)
  }

  const runPreImportStep = (load: FileLoad, context: VmFileContext): Effect.Effect<void> =>
    Effect.gen(function*() {
      load.refusal = yield* preImportRefusalFor(context)
    })

  const runImportStep = (load: FileLoad, file: string, context: VmFileContext): Effect.Effect<void> =>
    Effect.gen(function*() {
      const imported = yield* importOutcomeFor(context)
      applyImportReport(load, importReportOf(options.sandboxWorkingDirectory, file, imported))
    })

  const runAfterImportStep = (load: FileLoad, file: string, context: VmFileContext): Effect.Effect<void> =>
    Effect.gen(function*() {
      applyImportReport(load, yield* afterImportReport(file, context))
    })

  const applyCollectFailure = (deps: GraphLoadDeps, file: string, load: FileLoad): void => {
    load.failure = mergeFailure(load.failure, collectFailureFor(deps.registry, file))
  }

  const unlessRefused = (load: FileLoad, step: Effect.Effect<void>): Effect.Effect<void> =>
    load.refusal === undefined ? step : Effect.void

  const loadOneFile = (deps: FileLoadDeps, file: string): Effect.Effect<FileLoad> =>
    Effect.gen(function*() {
      const load: FileLoad = { refusal: undefined, failure: undefined }
      const context = fileContextFor(file, deps.saltOf)
      startFileLoad(deps, file)
      yield* unlessRefused(load, runPreImportStep(load, context))
      yield* unlessRefused(load, runImportStep(load, file, context))
      const overlay = capturedOverlay(EMPTY_EXCLUDED_KEYS)
      yield* unlessRefused(load, runAfterImportStep(load, file, context))
      yield* unlessRefused(load, Effect.sync(() => adoptOverlay(file, overlay)))
      yield* unlessRefused(load, Effect.sync(() => applyCollectFailure(deps, file, load)))
      return load
    })

  const isRefusedGraph = (loaded: readonly FileLoad[] | RefusedGraphBuild): loaded is RefusedGraphBuild =>
    'refusal' in loaded

  const recordLoad = (state: LoadState, load: FileLoad): void => {
    if (load.refusal === undefined) {
      state.loads.push(load)
      return
    }
    state.refusal = load.refusal
  }

  const loadFileStep = (deps: FileLoadDeps, file: string, state: LoadState): Effect.Effect<void> =>
    state.refusal === undefined
      ? Effect.map(loadOneFile(deps, file), (load) => {
        recordLoad(state, load)
      })
      : Effect.void

  const refusedOrLoads = (state: LoadState): readonly FileLoad[] | RefusedGraphBuild =>
    state.refusal === undefined ? state.loads : { refusal: state.refusal }

  const loadFiles = (
    deps: FileLoadDeps,
    files: readonly string[],
  ): Effect.Effect<readonly FileLoad[] | RefusedGraphBuild> =>
    Effect.gen(function*() {
      const state: LoadState = { refusal: undefined, loads: [] }
      for (const file of files) {
        yield* loadFileStep(deps, file, state)
      }
      return refusedOrLoads(state)
    })

  const firstFailureOf = (loads: readonly FileLoad[]): RunFailure | undefined =>
    loads.reduce<RunFailure | undefined>((found, load) => mergeFailure(found, load.failure), undefined)

  const prepareGraphIsolation = (): void => {
    if (isolate) {
      baselineGlobals = snapshotGlobals()
      baselineGlobalSymbols = snapshotGlobalSymbols()
      fileOverlays.clear()
    }
  }

  const fileSaltFor = (runSalt: string, index: number): string => isolate ? `${runSalt}-${index}` : runSalt

  const prepareFileSalts = (files: readonly string[]): (file: string) => string => {
    const runSalt = String(saltCounter += 1)
    const fileSalts = new Map<string, string>()
    files.forEach((file, index) => {
      if (!fileSalts.has(file)) {
        fileSalts.set(file, fileSaltFor(runSalt, index))
      }
    })
    const saltOf = (file: string): string => fileSalts.get(file) ?? runSalt
    saltOwners.clear()
    fileSalts.forEach((salt, file) => {
      saltOwners.set(salt, file)
    })
    return saltOf
  }

  const graphLoadOf = (
    deps: GraphLoadDeps,
    files: readonly string[],
  ): Effect.Effect<LoadedGraphBuild | RefusedGraphBuild> =>
    Effect.gen(function*() {
      yield* stage('beforeGraphLoad', { registry: deps.registry, files }, host)
      prepareGraphIsolation()
      const saltOf = prepareFileSalts(files)
      const loads = yield* loadFiles({ ...deps, saltOf }, files)
      if (isRefusedGraph(loads)) {
        return loads
      }
      return { graph: { registry: deps.registry, files, saltOf }, failure: firstFailureOf(loads) }
    })

  const resolveVitestOrRefusal = (): VitestResolution => {
    try {
      return { vitest: host.resolveVitest() }
    } catch (cause) {
      return { refusal: errorText(cause) }
    }
  }

  const isVitestRefusal = (resolved: VitestResolution): resolved is RefusedGraphBuild => 'refusal' in resolved

  const guardedExpectFor = (vitest: VitestModuleNamespace): object | undefined =>
    vitest.createExpect === undefined
      ? guardedExpect(vitest.expect)
      : dispatchingExpect(vitest.expect, vitest.createExpect)

  const guardedViOf = (vitest: VitestModuleNamespace): object | undefined =>
    vitest.vi === undefined ? undefined : guardedVi(vitest.vi)

  const runnerGlobalStateFor = (
    api: HarnessApi,
    registry: TestRegistry,
    vitest: VitestModuleNamespace,
  ): VmRunnerGlobalState => ({
    api,
    expect: guardedExpectFor(vitest),
    vi: guardedViOf(vitest),
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
  })

  const graphLoadFor = (files: readonly string[]): Effect.Effect<LoadedGraphBuild | RefusedGraphBuild> => {
    const registry = createRegistry()
    activeRegistry = registry
    const api = createHarnessApi(registry)
    installedApi = api
    const resolved = resolveVitestOrRefusal()
    if (isVitestRefusal(resolved)) {
      return Effect.succeed(resolved)
    }
    const runtime = vitestRuntimeOf()
    const base = runnerGlobalStateFor(api, registry, resolved.vitest)
    return graphLoadOf({ registry, base, runtime }, files)
  }

  const buildGraph = (files: readonly string[]): Effect.Effect<LoadedGraphBuild | RefusedGraphBuild> =>
    entryRefusal === undefined ? graphLoadFor(files) : Effect.succeed({ refusal: entryRefusal })

  const loadErrorTest = (failure: RunFailure, timeSpentMs: number): VmTestResult => ({
    id: testIdFor(options.sandboxWorkingDirectory, failure.file, 'load error'),
    name: `${failure.file} (load error)`,
    status: 'failed',
    failureMessage: failure.message,
    timeSpentMs,
  })

  const emptySuiteTestOf = (file: string): VmTestResult => ({
    id: testIdFor(options.sandboxWorkingDirectory, file, 'no test suite'),
    name: `${file} (no test suite)`,
    status: 'failed',
    failureMessage: `No test suite found in file ${file}`,
    timeSpentMs: 0,
  })

  const isUnpopulatedDiscovered = (
    file: string,
    discovered: ReadonlySet<string>,
    populated: ReadonlySet<string>,
  ): boolean => discovered.has(file) && !populated.has(file)

  const isEmptySuiteCandidate = (
    file: string,
    discovered: ReadonlySet<string>,
    populated: ReadonlySet<string>,
    loadFailureFile: string | undefined,
  ): boolean => file !== loadFailureFile && isUnpopulatedDiscovered(file, discovered, populated)

  const emptySuiteTests = (loaded: LoadedGraph, loadFailureFile: string | undefined): VmTestResult[] => {
    const discovered = new Set(discoveredFiles() ?? [])
    const populated = new Set(loaded.registry.tests.map((test) => test.file))
    return loaded.files
      .filter((file) => isEmptySuiteCandidate(file, discovered, populated, loadFailureFile))
      .map(emptySuiteTestOf)
  }

  const isTimedOutDrain = (drained: DrainOutcome): drained is TimedOutDrain => drained.kind === 'timeout'

  const elapsedOf = (drained: DrainedCompletion): number =>
    drained.tests.reduce((total, test) => total + test.timeSpentMs, 0)

  const failureMessageFor = (test: DrainedTest): string => test.failureMessage ?? ''

  const testResultFor = (test: DrainedTest): VmTestResult => {
    const base: VmTestResult = {
      id: testIdFor(options.sandboxWorkingDirectory, test.file, test.fullName),
      name: test.fullName,
      status: test.status,
      timeSpentMs: test.timeSpentMs,
    }
    return test.status === 'failed' ? { ...base, failureMessage: failureMessageFor(test) } : base
  }

  const drainedTestsOf = (drained: DrainedCompletion): VmTestResult[] =>
    drained.tests.map((test) => testResultFor(test))

  const loadFailureTests = (failure: RunFailure | undefined): VmTestResult[] =>
    failure === undefined ? [] : [loadErrorTest(failure, 0)]

  const loadFailureFileOf = (failure: RunFailure | undefined): string | undefined => failure?.file

  const relativePerTestOf = (
    perTest: VmMutantCoverage['perTest'],
  ): VmMutantCoverage['perTest'] =>
    Object.fromEntries(
      Object.entries(perTest).map(([testId, hits]) => [
        relativeTestIdOf(options.sandboxWorkingDirectory, testId),
        hits,
      ]),
    )

  const relativeCoverageOf = (raw: VmMutantCoverage | undefined): VmMutantCoverage | undefined =>
    raw === undefined ? undefined : { static: raw.static, perTest: relativePerTestOf(raw.perTest) }

  const rawCoverageOf = (context: ResponseContext): VmMutantCoverage | undefined =>
    context.request.kind === 'dry' ? readMutantCoverage(context.namespace) : undefined

  const mutantCoverageOf = (context: ResponseContext): VmMutantCoverage | undefined =>
    relativeCoverageOf(rawCoverageOf(context))

  const emptyRegistryResponse = (context: ResponseContext, drained: DrainedCompletion): VmRunResponse =>
    context.failure === undefined
      ? { status: 'init-failed', message: ZERO_TESTS_MESSAGE }
      : { status: 'complete', tests: [loadErrorTest(context.failure, elapsedOf(drained))] }

  const completeResponse = (context: ResponseContext, drained: DrainedCompletion): VmRunResponse => {
    const tests = drainedTestsOf(drained)
    tests.push(...loadFailureTests(context.failure))
    tests.push(...emptySuiteTests(context.loaded, loadFailureFileOf(context.failure)))
    const mutantCoverage = mutantCoverageOf(context)
    return mutantCoverage === undefined
      ? { status: 'complete', tests }
      : { status: 'complete', tests, mutantCoverage }
  }

  const completedResponse = (context: ResponseContext, drained: DrainedCompletion): VmRunResponse =>
    context.loaded.registry.tests.length === 0
      ? emptyRegistryResponse(context, drained)
      : completeResponse(context, drained)

  const respondWith = (context: ResponseContext, drained: DrainOutcome): VmRunResponse =>
    isTimedOutDrain(drained) ? { status: 'timeout' } : completedResponse(context, drained)

  const armedMutantIdOf = (request: VmRunRequest): string | undefined =>
    request.kind === 'mutant' ? request.activeMutantId : undefined

  const resetCoverageIfDry = (request: VmRunRequest, namespace: StrykerNamespace): void => {
    if (request.kind === 'dry') {
      resetMutantCoverage(namespace)
    }
  }

  const isReusableRequest = (request: VmRunRequest): boolean =>
    request.kind !== 'mutant' && request.reloadEnvironment === false

  const isCachedGraphReusable = (
    request: VmRunRequest,
    absoluteFilter: readonly string[] | undefined,
    cached: LoadedGraph,
  ): boolean => isReusableRequest(request) && graphCoversFilter(cached.files, absoluteFilter)

  const reusableGraph = (
    request: VmRunRequest,
    absoluteFilter: readonly string[] | undefined,
  ): LoadedGraph | undefined =>
    Option.getOrUndefined(
      Option.filter(
        Option.fromNullishOr(graph),
        (cached) => isCachedGraphReusable(request, absoluteFilter, cached),
      ),
    )

  const filesToLoad = (absoluteFilter: readonly string[] | undefined): readonly string[] =>
    ownedFilesOf(runnableFilesOf(options.testFiles, discoveredFiles()), absoluteFilter)

  const readyPreparation = (loaded: LoadedGraph, failure: RunFailure | undefined): RunReady => ({
    kind: 'ready',
    loaded,
    failure,
  })

  const refusedPreparation = (response: VmRunResponse): RunRefused => ({ kind: 'refused', response })

  const isRefusedBuild = (built: LoadedGraphBuild | RefusedGraphBuild): built is RefusedGraphBuild => 'refusal' in built

  const adoptBuild = (built: LoadedGraphBuild | RefusedGraphBuild): RunPreparation => {
    if (isRefusedBuild(built)) {
      return refusedPreparation({ status: 'init-failed', message: built.refusal })
    }
    graph = built.graph
    return readyPreparation(built.graph, built.failure)
  }

  const freshGraphOf = (files: readonly string[]): Effect.Effect<RunPreparation> =>
    Effect.gen(function*() {
      const previous = graph
      graph = undefined
      if (previous !== undefined) {
        yield* stage('disposeGraph', graphContextFor(previous), host)
      }
      const built = yield* buildGraph(files)
      return adoptBuild(built)
    })

  const freshPreparation = (absoluteFilter: readonly string[] | undefined): Effect.Effect<RunPreparation> =>
    Effect.gen(function*() {
      const files = filesToLoad(absoluteFilter)
      if (files.length === 0) {
        return refusedPreparation({ status: 'init-failed', message: ZERO_TESTS_MESSAGE })
      }
      return yield* freshGraphOf(files)
    })

  const preparedRun = (
    request: VmRunRequest,
    absoluteFilter: readonly string[] | undefined,
  ): Effect.Effect<RunPreparation> =>
    Effect.gen(function*() {
      const cached = reusableGraph(request, absoluteFilter)
      if (cached === undefined) {
        return yield* freshPreparation(absoluteFilter)
      }
      return readyPreparation(cached, undefined)
    })

  const allowOnlyFlagOf = (runtime: VmVitestRuntime | undefined, file: string): boolean | undefined =>
    runtime?.projectFor(file).allowOnly

  const allowOnlyFor = (runtime: VmVitestRuntime | undefined, file: string): boolean =>
    allowOnlyFlagOf(runtime, file) ?? false

  const beforeFileRunStage = (file: string, saltOf: (file: string) => string): Promise<void> => {
    applyFileOverlay(file)
    return runStage(plugins, 'beforeFileRun', fileContextFor(file, saltOf), host).then(() => {
      absorbEnvironmentKeys()
    })
  }

  const afterFileRunStage = (file: string, saltOf: (file: string) => string): Promise<void> => {
    const done = runStage(plugins, 'afterFileRun', fileContextFor(file, saltOf), host)
    return Promise.resolve(done).then(() => {
      recaptureFileOverlay(file)
    })
  }

  const drainOptionsFor = (
    request: VmRunRequest,
    absoluteFilter: readonly string[] | undefined,
    saltOf: (file: string) => string,
    runtime: VmVitestRuntime | undefined,
  ): DrainRunOptions => ({
    testFilter: absoluteFilter,
    allowOnlyFor: (file: string) => allowOnlyFor(runtime, file),
    configFor: (file: string) => runtime?.projectFor(file),
    beforeFileRun: (file: string) => beforeFileRunStage(file, saltOf),
    afterFileRun: (file: string) => afterFileRunStage(file, saltOf),
    beforeTest: (ref: DrainTestRef) => runStage(plugins, 'beforeTest', testContextFor(ref, request.kind), host),
    afterTest: (ref: DrainTestRef, outcome: DrainTestOutcome) =>
      runStage(plugins, 'afterTest', testContextFor(ref, request.kind), outcome, host),
  })

  const drainAndRespond = (
    prepared: RunReady,
    request: VmRunRequest,
    absoluteFilter: readonly string[] | undefined,
    namespace: StrykerNamespace,
  ): Effect.Effect<VmRunResponse> =>
    Effect.gen(function*() {
      const runtime = vitestRuntimeOf()
      const drained = yield* Effect.promise(() =>
        executeDrainRegistry(
          prepared.loaded.registry,
          request.timeoutMs,
          drainOptionsFor(request, absoluteFilter, prepared.loaded.saltOf, runtime),
        )
      )
      const response = respondWith({
        sandboxWorkingDirectory: options.sandboxWorkingDirectory,
        loaded: prepared.loaded,
        failure: prepared.failure,
        request,
        namespace,
      }, drained)
      const afterRun: VmRunContext = { request, graph: graphContextFor(prepared.loaded), response }
      yield* stage('afterRun', afterRun, host)
      return response
    })

  const coveredRun = (request: VmRunRequest, namespace: StrykerNamespace): Effect.Effect<VmRunResponse> =>
    Effect.gen(function*() {
      armMutant(namespace, armedMutantIdOf(request), request.hitLimit)
      resetCoverageIfDry(request, namespace)
      const absoluteFilter = absoluteFilterOf(request)
      const prepared = yield* preparedRun(request, absoluteFilter)
      if (prepared.kind === 'refused') {
        return prepared.response
      }
      return yield* drainAndRespond(prepared, request, absoluteFilter, namespace)
    })

  const executeRun = (request: VmRunRequest): Effect.Effect<VmRunResponse> =>
    Effect.gen(function*() {
      const namespace = hostStrykerNamespace()
      const previousArmed = readArmedMutant(namespace)
      const restoreArmed = Effect.sync(() => writeArmedMutant(namespace, previousArmed))
      return yield* coveredRun(request, namespace).pipe(Effect.ensuring(restoreArmed))
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

  const disposePlugin = (plugin: VmSessionPlugin): Effect.Effect<void> =>
    Effect.promise(() => Promise.resolve(plugin.dispose?.(host)))

  const disposePlugins = (): Effect.Effect<void> =>
    Effect.gen(function*() {
      for (const plugin of [...plugins].reverse()) {
        yield* disposePlugin(plugin)
      }
    })

  const disposeGraphOnce = (): Effect.Effect<void> => {
    const loaded = graph
    graph = undefined
    return loaded === undefined ? Effect.void : stage('disposeGraph', graphContextFor(loaded), host)
  }

  const isOwnedGlobalState = (installed: VmRunnerGlobalState | undefined): boolean =>
    installed === undefined || installed.api === installedApi

  const releaseInstalledState = (): void => {
    if (isOwnedGlobalState(readGlobalState())) {
      writeGlobalState(undefined)
    }
  }

  const releaseSessionGlobals = (): void => {
    restoreExit?.()
    restoreHostWorkerState()
    releaseInstalledState()
    deactivateSandbox()
    uninstallInterception()
  }

  const dispose = (): Promise<void> =>
    Effect.runPromise(
      Effect.gen(function*() {
        if (disposed) {
          return
        }
        disposed = true
        yield* disposeGraphOnce()
        yield* disposePlugins()
        releaseSessionGlobals()
      }),
    )

  const recordEntryRefusal = (entry: string | undefined): void => {
    if (entry === undefined) {
      entryRefusal = vitestMissingMessage(options.sandboxWorkingDirectory)
    }
  }

  const vitestNamespaceOf = (entry: string): Effect.Effect<VitestModuleNamespace> =>
    Effect.promise(() =>
      nativeImport<VitestModuleNamespace>(entry).catch(<A = unknown>(cause: A) => {
        throw new Error(`the vitest module could not be loaded for the session: ${errorText(cause)}`)
      })
    )

  const initStageIfNeeded = (): Effect.Effect<void> => entryRefusal === undefined ? stage('init', host) : Effect.void

  const bootSession = (): Effect.Effect<VmSession> =>
    Effect.gen(function*() {
      const entry = resolveSandboxEntry()
      recordEntryRefusal(entry)
      restoreExit = installExitGuard(options.sandboxWorkingDirectory)
      installInterception(moduleBuiltin, { host, plugins })
      activateSandbox(prefix)
      if (entry !== undefined) {
        vitestNamespace = yield* vitestNamespaceOf(entry)
      }
      yield* initStageIfNeeded()
      return { run, dispose }
    })

  return Effect.runPromise(bootSession())
}

const createSessionWithPlugins = (
  options: VmSessionOptions,
  plugins?: readonly VmSessionPlugin[],
): Promise<VmSession> => createSession(options, plugins ?? builtinPlugins)

export const createVmSession: {
  (plugins?: readonly VmSessionPlugin[]): (options: VmSessionOptions) => Promise<VmSession>
  (options: VmSessionOptions, plugins?: readonly VmSessionPlugin[]): Promise<VmSession>
} = dual(startsWithSessionOptions, createSessionWithPlugins)
