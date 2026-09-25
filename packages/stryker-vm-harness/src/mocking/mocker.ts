import * as Effect from 'effect/Effect'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'

import {
  createRequire,
  fileURLToPath,
  isBuiltin,
  pathToFileURL,
  readFileSync,
  stripTypeScriptTypes,
} from './node-builtins.js'

import { harnessUrlForSpecifier } from '../harness-sources.js'
import {
  actualUrlOf,
  cleanModuleUrl,
  extensionFallbacksOf,
  freshModuleUrlOf,
  hasActualQuery,
  missingExportMessage,
  MOCK_GLOBAL_KEY,
  MOCK_NAMESPACE_MARKER,
  type MockFactory,
  type MockFactoryOrOptions,
  mockGenerationOfUrl,
  mockKeyOf,
  mockKindOf,
  type MockLoadKind,
  mockLoadKindOfUrl,
  mockLoadUrlOf,
  mockModuleUrl,
  mockResolutionEntryIdOf,
  parseMockModuleUrl,
  renderMockModuleSource,
  saltOfUrl,
  stripActualQuery,
  stripMockGenerationQueryOf,
  stripMockLoadQuery,
  stripSaltQueryOf,
  withMockGenerationQuery,
  withSaltQuery,
} from '../mock-module.js'
import { nativeImport } from '../native-import.js'
import { MockTargetCommand, resolveMockTarget } from '../resolve-mock-target.workflow.js'
import type {
  LoadFnOutput,
  LoadHookContext,
  LoadHookSync,
  ResolveFnOutput,
  ResolveHookContext,
  ResolveHookSync,
} from '../session-plugin.js'
import { hoistTestFile } from './hoist.js'
import type { VitestMockerModules } from './vitest-modules.js'

export type MockResolveContext = ResolveHookContext
export type MockLoadContext = LoadHookContext

type MockResolveContinuation = (specifier: string, context: ResolveHookContext) => ResolveFnOutput

const unavailableContinuation = (): never => {
  throw new Error('the vm runner never delegates to a hook continuation')
}

const resolveContinuationOf = (next: ResolveHookSync): MockResolveContinuation => {
  const continuation: MockResolveContinuation = (specifier, context) =>
    next(specifier, context, unavailableContinuation)
  return continuation
}

type MockLoadContinuation = (url: string, context: LoadHookContext) => LoadFnOutput

const loadContinuationOf = (next: LoadHookSync): MockLoadContinuation => {
  const continuation: MockLoadContinuation = (url, context) => next(url, context, unavailableContinuation)
  return continuation
}

export type { MockFactory, MockFactoryOrOptions }

export interface ModuleMockContext {
  readonly callstack: ReadonlyArray<string> | null
}

export interface VitestModuleMocker {
  readonly queueMock: (id: string, importer: string, factoryOrOptions?: MockFactoryOrOptions) => void
  readonly queueUnmock: (id: string, importer: string) => void
  readonly importActual: <A = object>(
    rawId: string,
    importer: string,
    callstack?: ReadonlyArray<string> | null,
  ) => Promise<A>
  readonly importMock: (rawId: string, importer: string) => Promise<object>
  readonly mockObject: (object: object, mockExportsOrModuleType?: object | string, moduleType?: string) => object
  readonly getMockContext: () => ModuleMockContext
  readonly getFactoryModule: (entryId: string) => Promise<object>
  readonly wrapDynamicImport: (factory: () => Promise<object>) => Promise<object>
  readonly mockImportSpecifier: (importerUrl: string, specifier: string, options?: object) => string
  readonly resetModules: () => void
  readonly reset: () => void
}

export interface MockFileScope {
  readonly salt: string
  readonly url: string
}

export interface MockRuntimeOptions {
  readonly root: string
  readonly modules: VitestMockerModules
  readonly resolveId: (specifier: string, importerUrl: string) => string
  readonly isHoistableUrl: (url: string) => boolean
}

export interface MockRuntime {
  readonly mocker: VitestModuleMocker
  readonly flush: () => Promise<void>
  readonly beginFile: (file: MockFileScope) => void
  readonly endFile: () => void
  readonly beginRun: (file: MockFileScope) => void
  readonly endRun: () => void
  readonly resolveStage: (
    specifier: string,
    context: MockResolveContext,
    next: ResolveHookSync,
  ) => ResolveFnOutput | undefined
  readonly loadStage: (url: string, context: MockLoadContext, next: LoadHookSync) => LoadFnOutput | undefined
  readonly dispose: () => void
}

interface MockEntry {
  readonly id: string
  readonly salt: string
  readonly key: string
  readonly raw: string
  readonly kind: 'manual' | 'automock' | 'autospy' | 'redirect'
  readonly factory: MockFactory | undefined
  readonly sourceUrl: string
  readonly redirectPath: string | undefined
  readonly createdDuringRun: boolean
  resolved: boolean
  result: object
  exportNames: readonly string[]
}

interface PendingMock {
  readonly action: 'mock' | 'unmock'
  readonly specifier: string
  readonly importerUrl: string
  readonly salt: string
  readonly factoryOrOptions: MockFactoryOrOptions
  resolvedUrl: string | undefined
}

interface PendingBuckets {
  readonly matched: Array<PendingMock>
  readonly remaining: Array<PendingMock>
}

const pendingBuckets = (): PendingBuckets => ({ matched: [], remaining: [] })

const bucketPending =
  (isMatch: (item: PendingMock) => boolean): (buckets: PendingBuckets, item: PendingMock) => PendingBuckets =>
  (buckets, item) => {
    const target = isMatch(item) ? buckets.matched : buckets.remaining
    target.push(item)
    return buckets
  }

type ReflectiveValue = object | string | number | boolean | undefined

const REFLECTIVE_TYPES: Record<string, true> = {
  boolean: true,
  function: true,
  number: true,
  object: true,
  string: true,
}

const isReflectiveValue = (value: unknown): value is object | string | number | boolean =>
  REFLECTIVE_TYPES[typeof value] === true

export const reflectiveValue = <A = unknown>(value: A): ReflectiveValue => isReflectiveValue(value) ? value : undefined

const reflected = (target: object, property: PropertyKey, receiver?: object): ReflectiveValue =>
  reflectiveValue(Reflect.get(target, property, receiver))

const builtinRequire = createRequire(import.meta.url)

const mockPathOf = (resolvedUrl: string): string => {
  const clean = cleanModuleUrl(resolvedUrl)
  return clean.startsWith('file://') ? fileURLToPath(clean) : clean.replace(/^node:/, '')
}

const isMockNamespace = (value: object): boolean => typeof Reflect.get(value, MOCK_NAMESPACE_MARKER) === 'string'

const isUnmockedProperty = (property: PropertyKey): boolean => typeof property !== 'string' || property === 'then'

const shouldReflectVerbatim = (target: object, property: PropertyKey): boolean =>
  Reflect.has(target, property) || isUnmockedProperty(property)

const exportNameOf = (property: PropertyKey): string => typeof property === 'string' ? property : String(property)

const missingExportError = (property: PropertyKey, raw: ReflectiveValue): Error =>
  new Error(missingExportMessage(exportNameOf(property), typeof raw === 'string' ? raw : 'unknown'))

const raiseMissingExport = (target: object, property: PropertyKey): never => {
  throw missingExportError(property, reflected(target, MOCK_NAMESPACE_MARKER))
}

const mockNamespaceGet = (target: object, property: PropertyKey, receiver?: object): ReflectiveValue =>
  shouldReflectVerbatim(target, property)
    ? reflected(target, property, receiver)
    : raiseMissingExport(target, property)

const mockNamespaceProxy = (namespace: object): object =>
  new Proxy(namespace, {
    get: (target, property, receiver: object): ReflectiveValue => mockNamespaceGet(target, property, receiver),
    getOwnPropertyDescriptor: (target, property) =>
      property === MOCK_NAMESPACE_MARKER
        ? { value: reflected(target, property), enumerable: false, configurable: false, writable: false }
        : Reflect.getOwnPropertyDescriptor(target, property),
  })

const builtinReexportSource = (moduleUrl: string, exportNames: readonly string[]): string =>
  [
    `import * as __strykerBuiltin__ from ${JSON.stringify(actualUrlOf(cleanModuleUrl(moduleUrl)))}`,
    ...exportNames.map(
      (name, index) =>
        `const __builtin_export_${index}__ = __strykerBuiltin__[${
          JSON.stringify(name)
        }]\nexport { __builtin_export_${index}__ as ${JSON.stringify(name)} }`,
    ),
  ].join('\n')

export const createMockRuntime = (options: MockRuntimeOptions): MockRuntime => {
  const entries = new Map<string, MockEntry>()
  const entriesById = new Map<string, MockEntry>()
  const pending: PendingMock[] = []
  const generations = new Map<string, number>()
  const unqueued = new Set<string>()
  let activeFile: MockFileScope | undefined
  let runDepth = 0
  let entrySeq = 0

  const HARNESS_PREFIXES: ReadonlyArray<string> = ['vmrunner-harness:']
  const HARNESS_SEGMENTS: ReadonlyArray<string> = ['/stryker-vm-harness/dist/', '/vitest/dist/', '/@vitest/']

  const isHarnessImporter = (importer: string): boolean =>
    HARNESS_PREFIXES.some((prefix) => importer.startsWith(prefix)) ||
    HARNESS_SEGMENTS.some((segment) => importer.includes(segment))

  const isSandboxImporter = (importer: string): boolean => !isHarnessImporter(importer)

  const isSandboxImport = (importer: string): boolean => importer.length > 0 && isSandboxImporter(importer)

  const firstDefined = <A = unknown>(...values: ReadonlyArray<A | undefined>): A | undefined =>
    values.find((value) => value !== undefined)

  const activeUrl = (): string | undefined => (activeFile === undefined ? undefined : activeFile.url)

  const activeSalt = (): string | undefined => (activeFile === undefined ? undefined : activeFile.salt)

  const activeUrlOrDefault = (fallback: string): string => (activeFile === undefined ? fallback : activeFile.url)

  const saltOfUrlOrActive = (url: string): string | undefined => saltOfUrl(url) ?? activeSalt()

  const saltOfImporter = (importer: string): string =>
    firstDefined(saltOfUrl(importer), saltOfUrl(activeUrlOrDefault('')), activeSalt()) ?? ''

  const resolveImporterUrlOf = (importer: string): string =>
    isSandboxImport(importer) ? importer : activeUrlOrDefault(importer)

  const importerIfSandbox = (importer: string): string | undefined => isSandboxImport(importer) ? importer : undefined

  const importerIfPresent = (importer: string): string | undefined => importer.length > 0 ? importer : undefined

  const missingImporter = (): never => {
    throw new Error(
      `${MOCK_GLOBAL_KEY} could not determine the importing test file. Module mocks must run while a test file or setup file is being imported.`,
    )
  }

  const importerUrlOf = (importer: string): string =>
    firstDefined(importerIfSandbox(importer), activeUrl(), importerIfPresent(importer)) ?? missingImporter()

  const withHarnessSalt = (harnessUrl: string, salt: string): string =>
    salt === '' ? harnessUrl : `${harnessUrl}?salt=${salt}`

  const saltedHarnessUrl = (specifier: string, importerUrl: string): string | undefined => {
    const harnessUrl = harnessUrlForSpecifier(specifier)
    return harnessUrl === undefined ? undefined : withHarnessSalt(harnessUrl, saltOfImporter(importerUrl))
  }

  const builtinOrHarnessUrl = (specifier: string, importerUrl: string): string | undefined =>
    isBuiltin(specifier) ? specifier : saltedHarnessUrl(specifier, importerUrl)

  const tryResolveId = (specifier: string, importerUrl: string): string | undefined => {
    try {
      return options.resolveId(specifier, resolveImporterUrlOf(importerUrl))
    } catch {
      return undefined
    }
  }

  const firstResolvableFallback = (specifier: string, importerUrl: string): string | undefined =>
    extensionFallbacksOf(specifier).reduce<string | undefined>(
      (resolved, fallback) => resolved ?? tryResolveId(fallback, importerUrl),
      undefined,
    )

  const asError = <A = unknown>(cause: A): Error =>
    cause instanceof Error ? cause : new Error('module resolution failed', { cause })

  const raise = (error: Error): never => {
    throw error
  }

  const fallbackOrRaise = <A = unknown>(specifier: string, importerUrl: string, cause: A): string =>
    firstResolvableFallback(specifier, importerUrl) ?? raise(asError(cause))

  const resolveWithFallbacks = (specifier: string, importerUrl: string): string => {
    try {
      return options.resolveId(specifier, resolveImporterUrlOf(importerUrl))
    } catch (cause) {
      return fallbackOrRaise(specifier, importerUrl, cause)
    }
  }

  const resolveIdOrThrow = (specifier: string, importerUrl: string): string => {
    const direct = builtinOrHarnessUrl(specifier, importerUrl)
    if (direct !== undefined) {
      return direct
    }
    return resolveWithFallbacks(specifier, importerUrl)
  }

  const isAlreadyModuleUrl = (resolved: string): boolean => resolved.includes('://') || isBuiltin(resolved)

  const toModuleUrl = (resolved: string): string =>
    isAlreadyModuleUrl(resolved) ? resolved : pathToFileURL(resolved).href

  const entryForResolution = (resolved: string): MockEntry | undefined => {
    const entryId = mockResolutionEntryIdOf(resolved)
    return entryId === undefined ? undefined : entriesById.get(entryId)
  }

  const actualTargetOf = (resolved: string): string => {
    const entry = entryForResolution(resolved)
    return entry === undefined ? resolved : cleanModuleUrl(entry.sourceUrl)
  }

  const moduleUrlOf = (specifier: string, importerUrl: string): string =>
    toModuleUrl(actualTargetOf(resolveIdOrThrow(specifier, importerUrl)))

  const generationOr = (salt: string, fallback: number): number => generations.get(salt) ?? fallback

  const createEntry = (
    item: PendingMock,
    kind: MockEntry['kind'],
    redirectPath: string | undefined,
    sourceUrl: string,
  ): MockEntry => {
    entrySeq += 1
    const entry: MockEntry = {
      id: String(entrySeq),
      salt: item.salt,
      key: mockKeyOf(item.salt, sourceUrl),
      raw: item.specifier,
      kind,
      factory: typeof item.factoryOrOptions === 'function' ? item.factoryOrOptions : undefined,
      sourceUrl,
      redirectPath,
      createdDuringRun: runDepth > 0,
      resolved: false,
      result: {},
      exportNames: [],
    }
    entries.set(entry.key, entry)
    entriesById.set(entry.id, entry)
    return entry
  }

  const isExternalMockPath = (path: string): boolean => !path.startsWith('/') || path.includes('/node_modules/')

  const redirectPathFor = (builtin: boolean, path: string): string | null =>
    builtin ? null : options.modules.redirect.findMockRedirect(options.root, path, isExternalMockPath(path))

  const redirectPathArgOf = (builtin: boolean, path: string): string | undefined =>
    redirectPathFor(builtin, path) ?? undefined

  const mockTargetDecisionOf = (item: PendingMock, resolvedUrl: string, builtin: boolean, path: string) => {
    const decided = resolveMockTarget(
      MockTargetCommand.make({
        salt: item.salt,
        specifier: item.specifier,
        resolvedUrl,
        kind: mockKindOf(item.factoryOrOptions),
        isBuiltin: builtin,
        redirectPath: redirectPathArgOf(builtin, path),
      }),
    )
    return Result.isSuccess(decided) ? decided.success : raise(new Error('mock target decision failed'))
  }

  const registerMockItem = (item: PendingMock, resolvedUrl: string): MockEntry => {
    const saltedUrl = withSaltQuery(resolvedUrl, item.salt)
    const builtin = isBuiltin(cleanModuleUrl(resolvedUrl))
    const path = builtin ? cleanModuleUrl(resolvedUrl) : mockPathOf(resolvedUrl)
    const decision = mockTargetDecisionOf(item, resolvedUrl, builtin, path)
    return Match.value(decision).pipe(
      Match.tag('MockTargetSynthetic', (): MockEntry => createEntry(item, 'manual', undefined, saltedUrl)),
      Match.tag(
        'MockTargetRedirected',
        (redirected): MockEntry => createEntry(item, 'redirect', redirected.redirectPath, saltedUrl),
      ),
      Match.tag(
        'MockTargetAutomocked',
        (automocked): MockEntry => createEntry(item, automocked.kind, undefined, saltedUrl),
      ),
      Match.exhaustive,
    )
  }

  const deleteEntry = (entry: MockEntry): void => {
    entries.delete(entry.key)
    entriesById.delete(entry.id)
  }

  const resolvedUrlOf = (item: PendingMock): string => {
    const existing = item.resolvedUrl
    if (existing !== undefined) {
      return existing
    }
    const resolved = moduleUrlOf(item.specifier, item.importerUrl)
    item.resolvedUrl = resolved
    return resolved
  }

  const applyUnmock = (item: PendingMock, tombstone: string): void => {
    generations.set(item.salt, generationOr(item.salt, 0) + 1)
    const existing = entries.get(tombstone)
    if (existing !== undefined) {
      deleteEntry(existing)
    }
    unqueued.add(tombstone)
  }

  const applyMock = (item: PendingMock, resolvedUrl: string): void => {
    const entry = registerMockItem(item, resolvedUrl)
    unqueued.delete(entry.key)
    const previous = [...entries.values()].find((candidate) => candidate.key === entry.key && candidate.id !== entry.id)
    if (previous !== undefined) {
      deleteEntry(previous)
    }
  }

  const applyItem = (item: PendingMock): void => {
    const resolvedUrl = resolvedUrlOf(item)
    const tombstone = mockKeyOf(item.salt, resolvedUrl)
    if (item.action === 'unmock') {
      applyUnmock(item, tombstone)
      return
    }
    applyMock(item, resolvedUrl)
  }

  let drainDepth = 0

  const matchesKey = (item: PendingMock, salt: string, key: string): boolean =>
    item.salt === salt && mockKeyOf(item.salt, resolvedUrlOf(item)) === key

  const extractMatchingPending = (salt: string, key: string): ReadonlyArray<PendingMock> => {
    const buckets = pending.reduce(bucketPending((item) => matchesKey(item, salt, key)), pendingBuckets())
    pending.splice(0, pending.length, ...buckets.remaining)
    return buckets.matched
  }

  const drainPending = (salt: string, incomingUrl: string): void => {
    const key = mockKeyOf(salt, actualTargetOf(incomingUrl))
    for (const item of extractMatchingPending(salt, key)) {
      applyItem(item)
    }
  }

  const drainPendingSync = (salt: string, incomingUrl: string): void => {
    if (drainDepth > 0) {
      return
    }
    drainDepth += 1
    try {
      drainPending(salt, incomingUrl)
    } finally {
      drainDepth -= 1
    }
  }

  const awaitedEffect = <A = object>(outcome: A | Promise<A>): Effect.Effect<A> =>
    outcome instanceof Promise ? Effect.promise(() => outcome) : Effect.succeed(outcome)

  const importActualEffect = <A = object>(rawId: string, importer: string): Effect.Effect<A> =>
    Effect.gen(function*() {
      const importerUrl = importerUrlOf(importer)
      const resolvedUrl = toModuleUrl(actualTargetOf(resolveIdOrThrow(rawId, importerUrl)))
      const actual = isBuiltin(cleanModuleUrl(resolvedUrl))
        ? cleanModuleUrl(resolvedUrl)
        : withSaltQuery(actualUrlOf(resolvedUrl), saltOfImporter(importerUrl))
      return yield* Effect.promise(() => nativeImport<A>(actual))
    })

  const importOriginalFrom = (entry: MockEntry): Promise<object> =>
    Effect.runPromise(importActualEffect<object>(entry.raw, entry.sourceUrl))

  const unregisteredMockDefect = (entryId: string): Effect.Effect<never> =>
    Effect.die(new Error(`Mock ${entryId} wasn't registered. This is probably a bug in the vm runner's module mocker.`))

  const factorylessMockDefect = (entryId: string): Effect.Effect<never> =>
    Effect.die(new Error(`Mock ${entryId} has no factory. This is probably a bug in the vm runner's module mocker.`))

  const runFactoryEffect = (entry: MockEntry, entryId: string): Effect.Effect<object, Error> =>
    Effect.gen(function*() {
      const factory = entry.factory
      if (factory === undefined) {
        return yield* factorylessMockDefect(entryId)
      }
      entry.resolved = true
      const outcome = factory(() => importOriginalFrom(entry))
      const result = yield* awaitedEffect<object>(outcome)
      entry.result = result
      entry.exportNames = Object.keys(result)
      return result
    })

  const resolveManualEntryEffect = (entry: MockEntry, entryId: string): Effect.Effect<object, Error> =>
    entry.resolved ? Effect.succeed(entry.result) : runFactoryEffect(entry, entryId)

  const getFactoryModuleEffect = (entryId: string): Effect.Effect<object, Error> =>
    Effect.gen(function*() {
      const entry = entriesById.get(entryId)
      if (!isManualEntry(entry)) {
        return yield* unregisteredMockDefect(entryId)
      }
      return yield* resolveManualEntryEffect(entry, entryId)
    })

  const isManualEntry = (entry: MockEntry | undefined): entry is MockEntry =>
    entry !== undefined && entry.kind === 'manual'

  const mockResolvedUrlOf = (item: PendingMock): string | undefined =>
    item.action === 'mock' ? item.resolvedUrl : undefined

  const manualEntryFor = (item: PendingMock): MockEntry | undefined => {
    const resolvedUrl = mockResolvedUrlOf(item)
    if (resolvedUrl === undefined) {
      return undefined
    }
    return Option.getOrUndefined(
      Option.filter(Option.fromNullishOr(entries.get(mockKeyOf(item.salt, resolvedUrl))), isManualEntry),
    )
  }

  const warmMockFactoryEffect = (item: PendingMock): Effect.Effect<void, Error> =>
    Effect.gen(function*() {
      const entry = manualEntryFor(item)
      if (entry !== undefined) {
        yield* getFactoryModuleEffect(entry.id)
      }
    })

  const flushItem = (item: PendingMock): Effect.Effect<void, Error> =>
    Effect.gen(function*() {
      applyItem(item)
      yield* warmMockFactoryEffect(item)
    })

  const flushEffect = (): Effect.Effect<void, Error> =>
    Effect.gen(function*() {
      const queued = pending.splice(0, pending.length)
      for (const item of queued) {
        yield* flushItem(item)
      }
    })

  const loadKindOfEntry = (entry: MockEntry): MockLoadKind => (entry.kind === 'autospy' ? 'autospy' : 'automock')

  const saltedImportEffect = (url: string, salt: string): Effect.Effect<object, Error> =>
    Effect.promise(() => nativeImport<object>(withSaltQuery(url, salt)))

  const automockImportEffect = (resolvedUrl: string, kind: MockLoadKind): Effect.Effect<object, Error> =>
    Effect.promise(() => nativeImport<object>(mockLoadUrlOf(resolvedUrl, kind)))

  const redirectPathOfEntry = (entry: MockEntry): string | undefined =>
    entry.kind === 'redirect' ? entry.redirectPath : undefined

  const importKindMock = (entry: MockEntry, resolvedUrl: string, salt: string): Effect.Effect<object, Error> => {
    const redirectPath = redirectPathOfEntry(entry)
    return redirectPath === undefined
      ? automockImportEffect(resolvedUrl, loadKindOfEntry(entry))
      : saltedImportEffect(pathToFileURL(redirectPath).href, salt)
  }

  const importRegisteredMock = (entry: MockEntry, resolvedUrl: string, salt: string): Effect.Effect<object, Error> =>
    entry.kind === 'manual' ? getFactoryModuleEffect(entry.id) : importKindMock(entry, resolvedUrl, salt)

  const importMockByRedirect = (resolvedUrl: string, salt: string): Effect.Effect<object, Error> => {
    const path = mockPathOf(resolvedUrl)
    const redirectPath = options.modules.redirect.findMockRedirect(options.root, path, isExternalMockPath(path))
    return redirectPath === null
      ? automockImportEffect(resolvedUrl, 'automock')
      : saltedImportEffect(pathToFileURL(redirectPath).href, salt)
  }

  const importMockEffect = (rawId: string, importer: string): Effect.Effect<object, Error> =>
    Effect.gen(function*() {
      const importerUrl = importerUrlOf(importer)
      const salt = saltOfImporter(importerUrl)
      const resolvedUrl = withSaltQuery(toModuleUrl(actualTargetOf(resolveIdOrThrow(rawId, importerUrl))), salt)
      const entry = entries.get(mockKeyOf(salt, resolvedUrl))
      return yield* (entry === undefined
        ? importMockByRedirect(resolvedUrl, salt)
        : importRegisteredMock(entry, resolvedUrl, salt))
    })

  const exportsAndTypeOf = (
    mockExportsOrModuleType?: object | string,
    moduleType?: string,
  ): { readonly mockExports: object | undefined; readonly moduleType: string | undefined } =>
    typeof mockExportsOrModuleType === 'string'
      ? { mockExports: undefined, moduleType: mockExportsOrModuleType }
      : { mockExports: mockExportsOrModuleType, moduleType }

  const mockTypeOf = (moduleType: string | undefined): 'automock' | 'autospy' =>
    moduleType === 'autospy' ? 'autospy' : 'automock'

  const mockObject = (object: object, mockExportsOrModuleType?: object | string, moduleType?: string): object => {
    const { mockExports, moduleType: resolvedType } = exportsAndTypeOf(mockExportsOrModuleType, moduleType)
    return options.modules.globals.mockObject(
      {
        type: mockTypeOf(resolvedType),
        globalConstructors: { Object, Error, Function, RegExp, Symbol, Array, Map },
        createMockInstance: options.modules.spy.createMockInstance,
      },
      object,
      mockExports,
    )
  }

  const wrapDynamicImportEffect = (factory: () => Promise<object>): Effect.Effect<object, Error> =>
    Effect.gen(function*() {
      yield* flushEffect()
      const imported = yield* awaitedEffect<object>(factory())
      return isMockNamespace(imported) ? mockNamespaceProxy(imported) : imported
    })

  const resetModules = (): void => {
    const salt = activeSalt()
    if (salt !== undefined) {
      generations.set(salt, generationOr(salt, 0) + 1)
    }
  }

  const mockImportSpecifier = (importerUrl: string, specifier: string, _options?: object): string => {
    void _options
    const salt = saltOfImporter(importerUrl)
    return salt === '' ? specifier : withMockGenerationQuery(specifier, String(generationOr(salt, 0)))
  }

  const mocker: VitestModuleMocker = {
    queueMock: (id, importer, factoryOrOptions) => {
      const importerUrl = importerUrlOf(importer)
      pending.push({
        action: 'mock',
        specifier: id,
        importerUrl,
        salt: saltOfImporter(importerUrl),
        factoryOrOptions: factoryOrOptions ?? {},
        resolvedUrl: undefined,
      })
    },
    queueUnmock: (id, importer) => {
      const importerUrl = importerUrlOf(importer)
      pending.push({
        action: 'unmock',
        specifier: id,
        importerUrl,
        salt: saltOfImporter(importerUrl),
        factoryOrOptions: {},
        resolvedUrl: undefined,
      })
    },
    importActual: <A = object>(rawId: string, importer: string): Promise<A> =>
      Effect.runPromise(importActualEffect<A>(rawId, importer)),
    importMock: (rawId: string, importer: string): Promise<object> =>
      Effect.runPromise(importMockEffect(rawId, importer)),
    mockObject,
    getMockContext: () => ({ callstack: null }),
    getFactoryModule: (entryId: string): Promise<object> => Effect.runPromise(getFactoryModuleEffect(entryId)),
    wrapDynamicImport: (factory: () => Promise<object>): Promise<object> =>
      Effect.runPromise(wrapDynamicImportEffect(factory)),
    mockImportSpecifier,
    resetModules,
    reset: () => {
      entries.clear()
      entriesById.clear()
      pending.length = 0
      generations.clear()
    },
  }

  const redirectOutputFor = (entry: MockEntry): ResolveFnOutput => {
    const redirectPath = redirectPathOfEntry(entry)
    return redirectPath === undefined
      ? automockRedirectOutput(entry)
      : { url: withSaltQuery(pathToFileURL(redirectPath).href, entry.salt), shortCircuit: true }
  }

  const automockRedirectOutput = (entry: MockEntry): ResolveFnOutput => ({
    url: mockLoadUrlOf(entry.sourceUrl, loadKindOfEntry(entry)),
    shortCircuit: true,
  })

  const redirectFor = (entry: MockEntry): ResolveFnOutput =>
    Match.value(entry.kind).pipe(
      Match.when('manual', (): ResolveFnOutput => ({
        url: mockModuleUrl(entry.salt, entry.id),
        format: 'module',
        shortCircuit: true,
      })),
      Match.when('redirect', () => redirectOutputFor(entry)),
      Match.when('autospy', () => automockRedirectOutput(entry)),
      Match.when('automock', () => automockRedirectOutput(entry)),
      Match.exhaustive,
    )

  const saltOfSpecifier = (specifier: string): string => saltOfUrl(specifier) ?? ''

  const actualQueryOutputOf = (
    specifier: string,
    context: MockResolveContext,
    nextResolve: MockResolveContinuation,
  ): ResolveFnOutput => {
    const base = stripSaltQueryOf(stripActualQuery(specifier))
    const resolved = nextResolve(base, context)
    return isBuiltin(cleanModuleUrl(resolved.url))
      ? { url: cleanModuleUrl(resolved.url), format: resolved.format, shortCircuit: true }
      : { url: withSaltQuery(actualUrlOf(resolved.url), saltOfSpecifier(specifier)), shortCircuit: true }
  }

  const isMockStageSpecifier = (specifier: string): boolean =>
    specifier.startsWith('vmrunner-mock:') || mockLoadKindOfUrl(specifier) !== undefined

  const isHarnessParentUrl = (parentUrl: string | undefined): boolean =>
    parentUrl === undefined || parentUrl.startsWith('vmrunner-harness:')

  const nonHarnessParentUrl = (context: MockResolveContext): string | undefined => {
    const parentUrl = context.parentURL
    return isHarnessParentUrl(parentUrl) ? undefined : parentUrl
  }

  const parentSaltOf = (context: MockResolveContext): string | undefined => {
    const parentUrl = nonHarnessParentUrl(context)
    return parentUrl === undefined ? undefined : saltOfUrlOrActive(parentUrl)
  }

  const takeUnqueued = (salt: string, url: string): boolean => {
    const key = mockKeyOf(salt, url)
    const present = unqueued.has(key)
    if (present) {
      unqueued.delete(key)
    }
    return present
  }

  const freshStageOutput = (resolved: ResolveFnOutput, generation: number): ResolveFnOutput => ({
    url: freshModuleUrlOf(resolved.url, generation),
    format: resolved.format,
    shortCircuit: true,
  })

  const refreshedStageOutput = (resolved: ResolveFnOutput, generation: number): ResolveFnOutput => ({
    url: freshModuleUrlOf(resolved.url, generation),
    format: resolved.format,
    shortCircuit: resolved.shortCircuit,
    importAttributes: resolved.importAttributes,
  })

  const generationOutput = (salt: string, resolved: ResolveFnOutput): ResolveFnOutput => {
    const generation = generationOr(salt, 0)
    return generation === 0 ? resolved : refreshedStageOutput(resolved, generation)
  }

  const resolveTargetStage = (salt: string, resolved: ResolveFnOutput): ResolveFnOutput => {
    const actualTarget = actualTargetOf(resolved.url)
    return actualTarget === resolved.url ? generationOutput(salt, resolved) : { url: actualTarget, shortCircuit: true }
  }

  const resolveRefreshedStage = (
    specifier: string,
    context: MockResolveContext,
    nextResolve: MockResolveContinuation,
    salt: string,
  ): ResolveFnOutput => {
    const refreshed = nextResolve(stripMockGenerationQueryOf(specifier), context)
    drainPendingSync(salt, refreshed.url)
    const entry = entries.get(mockKeyOf(salt, refreshed.url))
    return entry === undefined ? refreshed : redirectFor(entry)
  }

  const resolveGenerationStage = (
    specifier: string,
    context: MockResolveContext,
    nextResolve: MockResolveContinuation,
    salt: string,
    resolved: ResolveFnOutput,
  ): ResolveFnOutput =>
    mockGenerationOfUrl(specifier) === undefined
      ? resolveTargetStage(salt, resolved)
      : resolveRefreshedStage(specifier, context, nextResolve, salt)

  const resolveUnregisteredStage = (
    specifier: string,
    context: MockResolveContext,
    nextResolve: MockResolveContinuation,
    salt: string,
    resolved: ResolveFnOutput,
  ): ResolveFnOutput =>
    takeUnqueued(salt, resolved.url)
      ? freshStageOutput(resolved, generationOr(salt, 1))
      : resolveGenerationStage(specifier, context, nextResolve, salt, resolved)

  const resolveSaltedStage = (
    specifier: string,
    context: MockResolveContext,
    nextResolve: MockResolveContinuation,
    salt: string,
  ): ResolveFnOutput => {
    const resolved = nextResolve(stripMockGenerationQueryOf(specifier), context)
    drainPendingSync(salt, resolved.url)
    const entry = entries.get(mockKeyOf(salt, actualTargetOf(resolved.url)))
    return entry === undefined
      ? resolveUnregisteredStage(specifier, context, nextResolve, salt, resolved)
      : redirectFor(entry)
  }

  const resolveActualQueryStage = (
    specifier: string,
    context: MockResolveContext,
    nextResolve: MockResolveContinuation,
  ): ResolveFnOutput | undefined =>
    hasActualQuery(specifier) ? actualQueryOutputOf(specifier, context, nextResolve) : undefined

  const resolveSaltedSpecifierStage = (
    specifier: string,
    context: MockResolveContext,
    nextResolve: MockResolveContinuation,
  ): ResolveFnOutput | undefined => {
    const salt = parentSaltOf(context)
    return salt === undefined ? undefined : resolveSaltedStage(specifier, context, nextResolve, salt)
  }

  const resolveMockStage = (
    specifier: string,
    context: MockResolveContext,
    nextResolve: MockResolveContinuation,
  ): ResolveFnOutput | undefined =>
    isMockStageSpecifier(specifier)
      ? undefined
      : resolveSaltedSpecifierStage(specifier, context, nextResolve)

  const resolveStage = (
    specifier: string,
    context: MockResolveContext,
    next: ResolveHookSync,
  ): ResolveFnOutput | undefined => {
    const nextResolve = resolveContinuationOf(next)
    const actualQuery = resolveActualQueryStage(specifier, context, nextResolve)
    if (actualQuery !== undefined) {
      return actualQuery
    }
    return resolveMockStage(specifier, context, nextResolve)
  }

  const automockedSourceOf = (javascript: string, kind: MockLoadKind, id: string): LoadFnOutput => ({
    format: 'module',
    source: options.modules.transforms.automockModule(javascript, kind, options.modules.parse, { id }).toString(),
    shortCircuit: true,
  })

  const isObjectValue = (value: unknown): value is object => typeof value === 'object' && value !== null

  const exportNamesOf = <A = unknown>(value: A): ReadonlyArray<string> => isObjectValue(value) ? Object.keys(value) : []

  const hasTypescriptFormat = (format: string | null | undefined): boolean => (format ?? '').includes('typescript')

  const isTypescriptFormat = (format: string | null | undefined, url: string): boolean =>
    hasTypescriptFormat(format) || isTypescriptUrl(url)

  const javascriptOf = (source: string, format: string | null | undefined, url: string): string =>
    isTypescriptFormat(format, url) ? stripTypeScriptTypes(source) : source

  const sourceOfResult = (result: LoadFnOutput, sourceUrl: string): string | undefined =>
    typeof result.source === 'string' ? result.source : readSourceOfUrl(sourceUrl)

  const builtinAutomockOutput = (sourceUrl: string, kind: MockLoadKind): LoadFnOutput =>
    automockedSourceOf(
      builtinReexportSource(sourceUrl, exportNamesOf(builtinRequire(cleanModuleUrl(sourceUrl)))),
      kind,
      sourceUrl,
    )

  const sourceAutomockOutput = (
    sourceUrl: string,
    context: MockLoadContext,
    nextLoad: MockLoadContinuation,
    kind: MockLoadKind,
  ): LoadFnOutput => {
    const result = nextLoad(sourceUrl, context)
    const source = sourceOfResult(result, sourceUrl)
    return source === undefined
      ? result
      : automockedSourceOf(javascriptOf(source, result.format, sourceUrl), kind, sourceUrl)
  }

  const automockOutput = (
    url: string,
    context: MockLoadContext,
    nextLoad: MockLoadContinuation,
    kind: MockLoadKind,
  ): LoadFnOutput => {
    const sourceUrl = stripMockLoadQuery(url)
    const clean = cleanModuleUrl(sourceUrl)
    return isBuiltin(clean)
      ? builtinAutomockOutput(sourceUrl, kind)
      : sourceAutomockOutput(sourceUrl, context, nextLoad, kind)
  }

  const collectExports = (
    sourceUrl: string,
    source: string,
    format: string | null | undefined,
  ): ReadonlyArray<string> =>
    options.modules.transforms.collectModuleExports(
      fileURLToPath(sourceUrl),
      javascriptOf(source, format, sourceUrl),
      'module',
    )

  const collectFromFile = (
    entry: MockEntry,
    sourceUrl: string,
    context: MockLoadContext,
    nextLoad: MockLoadContinuation,
  ): ReadonlyArray<string> => {
    const result = nextLoad(sourceUrl, context)
    const source = sourceOfResult(result, sourceUrl)
    return source === undefined ? entry.exportNames : collectExports(sourceUrl, source, result.format)
  }

  const originalExportNamesFrom = (
    entry: MockEntry,
    context: MockLoadContext,
    nextLoad: MockLoadContinuation,
  ): ReadonlyArray<string> => {
    const sourceUrl = cleanModuleUrl(entry.sourceUrl)
    return sourceUrl.startsWith('file://')
      ? collectFromFile(entry, sourceUrl, context, nextLoad)
      : entry.exportNames
  }

  const collectOriginalExportNames = (
    entry: MockEntry,
    context: MockLoadContext,
    nextLoad: MockLoadContinuation,
  ): ReadonlyArray<string> => {
    try {
      return originalExportNamesFrom(entry, context, nextLoad)
    } catch {
      return entry.exportNames
    }
  }

  const originalExportNamesOf = (
    entry: MockEntry,
    context: MockLoadContext,
    nextLoad: MockLoadContinuation,
  ): readonly string[] => entry.resolved ? entry.exportNames : collectOriginalExportNames(entry, context, nextLoad)

  const manualEntryById = (entryId: string): MockEntry => {
    const entry = entriesById.get(entryId)
    if (!isManualEntry(entry)) {
      throw new Error(`Mock ${entryId} wasn't registered. This is probably a bug in the vm runner's module mocker.`)
    }
    return entry
  }

  const exportNamesFor = (
    entry: MockEntry,
    context: MockLoadContext,
    nextLoad: MockLoadContinuation,
  ): ReadonlyArray<string> => entry.resolved ? entry.exportNames : originalExportNamesOf(entry, context, nextLoad)

  const mockModuleOutput = (
    entryId: string,
    context: MockLoadContext,
    nextLoad: MockLoadContinuation,
  ): LoadFnOutput => {
    const entry = manualEntryById(entryId)
    return {
      format: 'module',
      source: renderMockModuleSource({
        entryId: entry.id,
        raw: entry.raw,
        exportNames: exportNamesFor(entry, context, nextLoad),
      }),
      shortCircuit: true,
    }
  }

  const TYPESCRIPT_EXTENSIONS: Record<string, true> = {
    '.ts': true,
    '.mts': true,
    '.cts': true,
    '.tsx': true,
  }

  const extensionOfUrl = (url: string): string => {
    const clean = cleanModuleUrl(url)
    const lastSegment = clean.slice(clean.lastIndexOf('/') + 1)
    const dot = lastSegment.lastIndexOf('.')
    return dot === -1 ? '' : lastSegment.slice(dot)
  }

  const isTypescriptUrl = (url: string): boolean => TYPESCRIPT_EXTENSIONS[extensionOfUrl(url)] === true

  const readSourceOfUrl = (url: string): string | undefined => {
    const clean = cleanModuleUrl(url)
    return clean.startsWith('file://') ? readFileSync(fileURLToPath(clean)) : undefined
  }

  const isRequireOrUnhoistable = (url: string, context: MockLoadContext): boolean =>
    context.conditions.includes('require') || !options.isHoistableUrl(url)

  const hoistedSourceOutput = (url: string, source: string, format: string | null | undefined): LoadFnOutput => ({
    format: 'module',
    source: hoistTestFile(source, url, isTypescriptFormat(format, url), options.modules).source,
    shortCircuit: true,
  })

  const hoistedLoadOutput = (
    url: string,
    context: MockLoadContext,
    nextLoad: MockLoadContinuation,
  ): LoadFnOutput => {
    const result = nextLoad(url, context)
    const source = sourceOfResult(result, url)
    return source === undefined ? result : hoistedSourceOutput(url, source, result.format)
  }

  const hoistStage = (
    url: string,
    context: MockLoadContext,
    nextLoad: MockLoadContinuation,
  ): LoadFnOutput | undefined =>
    isRequireOrUnhoistable(url, context) ? undefined : hoistedLoadOutput(url, context, nextLoad)

  const mockKindOutput = (
    url: string,
    context: MockLoadContext,
    nextLoad: MockLoadContinuation,
  ): LoadFnOutput | undefined => {
    const kind = mockLoadKindOfUrl(url)
    return kind === undefined ? hoistStage(url, context, nextLoad) : automockOutput(url, context, nextLoad, kind)
  }

  const parsedMockOutput = (
    url: string,
    context: MockLoadContext,
    nextLoad: MockLoadContinuation,
  ): LoadFnOutput | undefined => {
    const parsed = parseMockModuleUrl(url)
    return parsed === undefined ? undefined : mockModuleOutput(parsed.entryId, context, nextLoad)
  }

  const loadStage = (url: string, context: MockLoadContext, next: LoadHookSync): LoadFnOutput | undefined => {
    const nextLoad = loadContinuationOf(next)
    const parsedOutput = parsedMockOutput(url, context, nextLoad)
    if (parsedOutput !== undefined) {
      return parsedOutput
    }
    return mockKindOutput(url, context, nextLoad)
  }

  const isRunEntry = (entry: MockEntry, salt: string): boolean => entry.salt === salt && entry.createdDuringRun

  const deleteRunEntry = (entry: MockEntry, salt: string): void => {
    if (isRunEntry(entry, salt)) {
      deleteEntry(entry)
    }
  }

  const pruneRunEntries = (salt: string): void => {
    for (const entry of entries.values()) {
      deleteRunEntry(entry, salt)
    }
  }

  return {
    mocker,
    flush: (): Promise<void> => Effect.runPromise(flushEffect()),
    beginFile: (file) => {
      activeFile = file
    },
    endFile: () => {
      activeFile = undefined
    },
    beginRun: (file) => {
      activeFile = file
      runDepth += 1
      pruneRunEntries(file.salt)
      pending.length = 0
    },
    endRun: () => {
      runDepth = Math.max(0, runDepth - 1)
    },
    resolveStage,
    loadStage,
    dispose: mocker.reset,
  }
}
