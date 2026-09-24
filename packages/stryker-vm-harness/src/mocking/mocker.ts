import type { LoadFnOutput, LoadHookSync, ResolveFnOutput, ResolveHookSync } from 'node:module'

import * as Effect from 'effect/Effect'
import * as Match from 'effect/Match'
import * as Result from 'effect/Result'

import {
  createRequire,
  fileURLToPath,
  isBuiltin,
  pathToFileURL,
  readFileSync,
  stripTypeScriptTypes,
} from './node-builtins.js'

import { harnessUrlForSpecifier } from '../harness-sources.handle.js'
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
import type { MockRequestKind } from '../mock-registry.schema.js'
import { nativeImport } from '../native-import.handle.js'
import { MockTargetCommand, resolveMockTarget } from '../resolve-mock-target.workflow.js'
import { hoistTestFile } from './hoist.js'
import type { VitestMockerModules } from './vitest-modules.js'

export type MockResolveContext = Parameters<ResolveHookSync>[1]
export type MockLoadContext = Parameters<LoadHookSync>[1]

type MockResolveContinuation = (
  specifier: Parameters<ResolveHookSync>[0],
  context?: Partial<Parameters<ResolveHookSync>[1]>,
) => ResolveFnOutput

const resolveContinuationOf = (next: ResolveHookSync): MockResolveContinuation => next as MockResolveContinuation

type MockLoadContinuation = (
  url: Parameters<LoadHookSync>[0],
  context?: Partial<Parameters<LoadHookSync>[1]>,
) => LoadFnOutput

const loadContinuationOf = (next: LoadHookSync): MockLoadContinuation => next as MockLoadContinuation

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

const builtinRequire = createRequire(import.meta.url)

const mockPathOf = (resolvedUrl: string): string => {
  const clean = cleanModuleUrl(resolvedUrl)
  return clean.startsWith('file://') ? fileURLToPath(clean) : clean.replace(/^node:/, '')
}

const isMockNamespace = (value: object): boolean => typeof Reflect.get(value, MOCK_NAMESPACE_MARKER) === 'string'

const reflected = (target: object, property: PropertyKey, receiver?: object): object | string | undefined =>
  Reflect.get(target, property, receiver) as object | string | undefined

const mockNamespaceProxy = (namespace: object): object =>
  new Proxy(namespace, {
    get(target, property, receiver) {
      const owner = receiver as object | undefined
      if (Reflect.has(target, property)) {
        return reflected(target, property, owner)
      }
      if (typeof property !== 'string' || property === 'then') {
        return reflected(target, property, owner)
      }
      const raw = reflected(target, MOCK_NAMESPACE_MARKER)
      throw new Error(missingExportMessage(property, typeof raw === 'string' ? raw : 'unknown'))
    },
    getOwnPropertyDescriptor(target, property) {
      if (property === MOCK_NAMESPACE_MARKER) {
        return { value: reflected(target, property), enumerable: false, configurable: false, writable: false }
      }
      return Reflect.getOwnPropertyDescriptor(target, property)
    },
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

  const isSandboxImporter = (importer: string): boolean =>
    !(
      importer.startsWith('vmrunner-harness:') ||
      importer.includes('/stryker-vm-harness/dist/') ||
      importer.includes('/vitest/dist/') ||
      importer.includes('/@vitest/')
    )

  const saltOfImporter = (importer: string): string =>
    saltOfUrl(importer) ?? saltOfUrl(activeFile?.url ?? '') ?? activeFile?.salt ?? ''

  const resolveImporterUrlOf = (importer: string): string =>
    importer.length > 0 && isSandboxImporter(importer) ? importer : (activeFile?.url ?? importer)
  const importerUrlOf = (importer: string): string => {
    if (importer.length > 0 && isSandboxImporter(importer)) {
      return importer
    }
    if (activeFile !== undefined) {
      return activeFile.url
    }
    if (importer.length > 0) {
      return importer
    }
    throw new Error(
      `${MOCK_GLOBAL_KEY} could not determine the importing test file. Module mocks must run while a test file or setup file is being imported.`,
    )
  }

  const resolveIdOrThrow = (specifier: string, importerUrl: string): string => {
    if (isBuiltin(specifier)) {
      return specifier
    }
    const harnessUrl = harnessUrlForSpecifier(specifier)
    if (harnessUrl !== undefined) {
      const salt = saltOfImporter(importerUrl)
      return salt === '' ? harnessUrl : `${harnessUrl}?salt=${salt}`
    }
    try {
      return options.resolveId(specifier, resolveImporterUrlOf(importerUrl))
    } catch (cause) {
      for (const fallback of extensionFallbacksOf(specifier)) {
        try {
          return options.resolveId(fallback, resolveImporterUrlOf(importerUrl))
        } catch {
          continue
        }
      }
      throw cause
    }
  }

  const toModuleUrl = (resolved: string): string => {
    if (resolved.includes('://') || isBuiltin(resolved)) {
      return resolved
    }
    return pathToFileURL(resolved).href
  }

  const actualTargetOf = (resolved: string): string => {
    const entryId = mockResolutionEntryIdOf(resolved)
    if (entryId === undefined) {
      return resolved
    }
    const existing = entriesById.get(entryId)
    return existing === undefined ? resolved : cleanModuleUrl(existing.sourceUrl)
  }

  const moduleUrlOf = (specifier: string, importerUrl: string): string =>
    toModuleUrl(actualTargetOf(resolveIdOrThrow(specifier, importerUrl)))

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

  const registerMockItem = (item: PendingMock, resolvedUrl: string): MockEntry => {
    const saltedUrl = withSaltQuery(resolvedUrl, item.salt)
    const builtin = isBuiltin(cleanModuleUrl(resolvedUrl))
    const path = builtin ? cleanModuleUrl(resolvedUrl) : mockPathOf(resolvedUrl)
    const external = builtin ? false : !path.startsWith('/') || path.includes('/node_modules/')
    const redirectPath = builtin ? null : options.modules.redirect.findMockRedirect(options.root, path, external)
    const kind: MockRequestKind = mockKindOf(item.factoryOrOptions)
    const decided = resolveMockTarget(
      MockTargetCommand.make({
        salt: item.salt,
        specifier: item.specifier,
        resolvedUrl,
        kind,
        isBuiltin: isBuiltin(cleanModuleUrl(resolvedUrl)),
        redirectPath: redirectPath ?? undefined,
      }),
    )
    if (!Result.isSuccess(decided)) {
      throw new Error('mock target decision failed')
    }
    const decision = decided.success
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

  const applyItem = (item: PendingMock): void => {
    if (item.resolvedUrl === undefined) {
      item.resolvedUrl = moduleUrlOf(item.specifier, item.importerUrl)
    }
    const tombstone = mockKeyOf(item.salt, item.resolvedUrl)
    if (item.action === 'unmock') {
      generations.set(item.salt, (generations.get(item.salt) ?? 0) + 1)
      const existing = entries.get(tombstone)
      if (existing !== undefined) {
        deleteEntry(existing)
      }
      unqueued.add(tombstone)
      return
    }
    const entry = registerMockItem(item, item.resolvedUrl)
    unqueued.delete(entry.key)
    const previous = [...entries.values()].find((candidate) => candidate.key === entry.key && candidate.id !== entry.id)
    if (previous !== undefined) {
      deleteEntry(previous)
    }
  }

  let drainDepth = 0

  const drainPendingSync = (salt: string, incomingUrl: string): void => {
    if (drainDepth > 0) {
      return
    }
    drainDepth += 1
    try {
      const resolvedUrl = actualTargetOf(incomingUrl)
      const key = mockKeyOf(salt, resolvedUrl)
      const matched: PendingMock[] = []
      for (let index = pending.length - 1; index >= 0; index -= 1) {
        const item = pending[index]
        if (item === undefined || item.salt !== salt) {
          continue
        }
        if (item.resolvedUrl === undefined) {
          item.resolvedUrl = moduleUrlOf(item.specifier, item.importerUrl)
        }
        if (mockKeyOf(item.salt, item.resolvedUrl) === key) {
          const removed = pending.splice(index, 1)
          const removedItem = removed[0]
          if (removedItem !== undefined) {
            matched.unshift(removedItem)
          }
        }
      }
      for (const item of matched) {
        applyItem(item)
      }
    } finally {
      drainDepth -= 1
    }
  }

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

  const getFactoryModuleEffect = (entryId: string): Effect.Effect<object, Error> =>
    Effect.gen(function*() {
      const entry = entriesById.get(entryId)
      if (entry === undefined || entry.kind !== 'manual') {
        return yield* Effect.die(
          new Error(`Mock ${entryId} wasn't registered. This is probably a bug in the vm runner's module mocker.`),
        )
      }
      if (!entry.resolved) {
        const factory = entry.factory
        if (factory === undefined) {
          return yield* Effect.die(
            new Error(`Mock ${entryId} has no factory. This is probably a bug in the vm runner's module mocker.`),
          )
        }
        entry.resolved = true
        const outcome = factory(() => importOriginalFrom(entry))
        const result = yield* (outcome instanceof Promise ? Effect.promise(() => outcome) : Effect.succeed(outcome))
        entry.result = result
        entry.exportNames = Object.keys(result)
      }
      return entry.result
    })

  const flushEffect = (): Effect.Effect<void, Error> =>
    Effect.gen(function*() {
      const queued = pending.splice(0, pending.length)
      for (const item of queued) {
        applyItem(item)
        if (item.action === 'mock' && item.resolvedUrl !== undefined) {
          const entry = entries.get(mockKeyOf(item.salt, item.resolvedUrl))
          if (entry !== undefined && entry.kind === 'manual') {
            yield* getFactoryModuleEffect(entry.id)
          }
        }
      }
    })

  const importMockEffect = (rawId: string, importer: string): Effect.Effect<object, Error> =>
    Effect.gen(function*() {
      const importerUrl = importerUrlOf(importer)
      const salt = saltOfImporter(importerUrl)
      const resolvedUrl = withSaltQuery(toModuleUrl(actualTargetOf(resolveIdOrThrow(rawId, importerUrl))), salt)
      const entry = entries.get(mockKeyOf(salt, resolvedUrl))
      if (entry !== undefined) {
        if (entry.kind === 'manual') {
          return yield* getFactoryModuleEffect(entry.id)
        }
        const redirectPath = entry.kind === 'redirect' ? entry.redirectPath : undefined
        if (redirectPath !== undefined) {
          return yield* Effect.promise(() =>
            nativeImport<object>(withSaltQuery(pathToFileURL(redirectPath).href, salt))
          )
        }
        const kind: MockLoadKind = entry.kind === 'autospy' ? 'autospy' : 'automock'
        return yield* Effect.promise(() => nativeImport<object>(mockLoadUrlOf(resolvedUrl, kind)))
      }
      const path = mockPathOf(resolvedUrl)
      const external = !path.startsWith('/') || path.includes('/node_modules/')
      const redirectPath = options.modules.redirect.findMockRedirect(options.root, path, external)
      if (redirectPath !== null) {
        return yield* Effect.promise(() => nativeImport<object>(withSaltQuery(pathToFileURL(redirectPath).href, salt)))
      }
      return yield* Effect.promise(() => nativeImport<object>(mockLoadUrlOf(resolvedUrl, 'automock')))
    })

  const mockObject = (object: object, mockExportsOrModuleType?: object | string, moduleType?: string): object => {
    const moduleTypeOfExports = typeof mockExportsOrModuleType === 'string' ? mockExportsOrModuleType : moduleType
    const mockExports = typeof mockExportsOrModuleType === 'string' ? undefined : mockExportsOrModuleType
    return options.modules.globals.mockObject(
      {
        type: moduleTypeOfExports === 'autospy' ? 'autospy' : 'automock',
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
      const outcome = factory()
      const imported = yield* (outcome instanceof Promise ? Effect.promise(() => outcome) : Effect.succeed(outcome))
      return isMockNamespace(imported) ? mockNamespaceProxy(imported) : imported
    })

  const resetModules = (): void => {
    const salt = activeFile?.salt
    if (salt !== undefined) {
      generations.set(salt, (generations.get(salt) ?? 0) + 1)
    }
  }

  const mockImportSpecifier = (importerUrl: string, specifier: string, _options?: object): string => {
    void _options
    const salt = saltOfImporter(importerUrl)
    if (salt === '') {
      return specifier
    }
    return withMockGenerationQuery(specifier, String(generations.get(salt) ?? 0))
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

  const redirectFor = (entry: MockEntry): ResolveFnOutput => {
    if (entry.kind === 'manual') {
      return { url: mockModuleUrl(entry.salt, entry.id), format: 'module', shortCircuit: true }
    }
    if (entry.kind === 'redirect' && entry.redirectPath !== undefined) {
      return { url: withSaltQuery(pathToFileURL(entry.redirectPath).href, entry.salt), shortCircuit: true }
    }
    const kind: MockLoadKind = entry.kind === 'autospy' ? 'autospy' : 'automock'
    return { url: mockLoadUrlOf(entry.sourceUrl, kind), shortCircuit: true }
  }

  const resolveStage = (
    specifier: string,
    context: MockResolveContext,
    next: ResolveHookSync,
  ): ResolveFnOutput | undefined => {
    const nextResolve = resolveContinuationOf(next)
    if (hasActualQuery(specifier)) {
      const base = stripSaltQueryOf(stripActualQuery(specifier))
      const resolved = nextResolve(base, context)
      if (isBuiltin(cleanModuleUrl(resolved.url))) {
        return { url: cleanModuleUrl(resolved.url), format: resolved.format, shortCircuit: true }
      }
      return { url: withSaltQuery(actualUrlOf(resolved.url), saltOfUrl(specifier) ?? ''), shortCircuit: true }
    }
    if (specifier.startsWith('vmrunner-mock:') || mockLoadKindOfUrl(specifier) !== undefined) {
      return undefined
    }
    const parentUrl = context.parentURL
    if (parentUrl === undefined || parentUrl.startsWith('vmrunner-harness:')) {
      return undefined
    }
    const salt = saltOfUrl(parentUrl) ?? activeFile?.salt
    if (salt === undefined) {
      return undefined
    }
    const resolved = nextResolve(stripMockGenerationQueryOf(specifier), context)
    drainPendingSync(salt, resolved.url)
    const entry = entries.get(mockKeyOf(salt, actualTargetOf(resolved.url)))
    if (entry !== undefined) {
      return redirectFor(entry)
    }
    if (unqueued.has(mockKeyOf(salt, resolved.url))) {
      unqueued.delete(mockKeyOf(salt, resolved.url))
      return {
        url: freshModuleUrlOf(resolved.url, generations.get(salt) ?? 1),
        format: resolved.format,
        shortCircuit: true,
      }
    }
    if (mockGenerationOfUrl(specifier) !== undefined) {
      const refreshed = nextResolve(stripMockGenerationQueryOf(specifier), context)
      drainPendingSync(salt, refreshed.url)
      const entry = entries.get(mockKeyOf(salt, refreshed.url))
      if (entry !== undefined) {
        return redirectFor(entry)
      }
      return refreshed
    }
    const actualTarget = actualTargetOf(resolved.url)
    if (actualTarget !== resolved.url) {
      return { url: actualTarget, shortCircuit: true }
    }
    const generation = generations.get(salt) ?? 0
    if (generation === 0) {
      return resolved
    }
    return {
      url: freshModuleUrlOf(resolved.url, generation),
      format: resolved.format,
      shortCircuit: resolved.shortCircuit,
      importAttributes: resolved.importAttributes,
    }
  }

  const automockedSourceOf = (javascript: string, kind: MockLoadKind, id: string): LoadFnOutput => ({
    format: 'module',
    source: options.modules.transforms.automockModule(javascript, kind, options.modules.parse, { id }).toString(),
    shortCircuit: true,
  })

  const automockOutput = (
    url: string,
    context: MockLoadContext,
    nextLoad: MockLoadContinuation,
    kind: MockLoadKind,
  ): LoadFnOutput => {
    const sourceUrl = stripMockLoadQuery(url)
    const clean = cleanModuleUrl(sourceUrl)
    if (isBuiltin(clean)) {
      const exportNames = Object.keys(builtinRequire(clean) as object)
      return automockedSourceOf(builtinReexportSource(sourceUrl, exportNames), kind, sourceUrl)
    }
    const result = nextLoad(sourceUrl, context)
    const source = typeof result.source === 'string' ? result.source : readSourceOfUrl(sourceUrl)
    if (source === undefined) {
      return result
    }
    const javascript = (result.format ?? '').includes('typescript') || isTypescriptUrl(sourceUrl)
      ? stripTypeScriptTypes(source)
      : source
    return automockedSourceOf(javascript, kind, sourceUrl)
  }

  const originalExportNamesOf = (
    entry: MockEntry,
    context: MockLoadContext,
    nextLoad: MockLoadContinuation,
  ): readonly string[] => {
    if (entry.resolved) {
      return entry.exportNames
    }
    try {
      const sourceUrl = cleanModuleUrl(entry.sourceUrl)
      if (!sourceUrl.startsWith('file://')) {
        return entry.exportNames
      }
      const result = nextLoad(sourceUrl, context)
      const source = typeof result.source === 'string' ? result.source : readSourceOfUrl(sourceUrl)
      if (source === undefined) {
        return entry.exportNames
      }
      const code = (result.format ?? '').includes('typescript') || isTypescriptUrl(sourceUrl)
        ? stripTypeScriptTypes(source)
        : source
      return options.modules.transforms.collectModuleExports(fileURLToPath(sourceUrl), code, 'module')
    } catch {
      return entry.exportNames
    }
  }

  const mockModuleOutput = (
    entryId: string,
    context: MockLoadContext,
    nextLoad: MockLoadContinuation,
  ): LoadFnOutput => {
    const entry = entriesById.get(entryId)
    if (entry === undefined || entry.kind !== 'manual') {
      throw new Error(`Mock ${entryId} wasn't registered. This is probably a bug in the vm runner's module mocker.`)
    }
    return {
      format: 'module',
      source: renderMockModuleSource({
        entryId: entry.id,
        raw: entry.raw,
        exportNames: entry.resolved ? entry.exportNames : originalExportNamesOf(entry, context, nextLoad),
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
    return clean.startsWith('file://') ? readFileSync(fileURLToPath(clean), 'utf8') : undefined
  }

  const loadStage = (url: string, context: MockLoadContext, next: LoadHookSync): LoadFnOutput | undefined => {
    const nextLoad = loadContinuationOf(next)
    const parsed = parseMockModuleUrl(url)
    if (parsed !== undefined) {
      return mockModuleOutput(parsed.entryId, context, nextLoad)
    }
    const kind = mockLoadKindOfUrl(url)
    if (kind !== undefined) {
      return automockOutput(url, context, nextLoad, kind)
    }
    if (context.conditions.includes('require') || !options.isHoistableUrl(url)) {
      return undefined
    }
    const result = nextLoad(url, context)
    const source = typeof result.source === 'string'
      ? result.source
      : readSourceOfUrl(url)
    if (source === undefined) {
      return result
    }
    const isTypescript = (result.format ?? '').includes('typescript') || isTypescriptUrl(url)
    return {
      format: 'module',
      source: hoistTestFile(source, url, isTypescript, options.modules).source,
      shortCircuit: true,
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
      for (const entry of entries.values()) {
        if (entry.salt === file.salt && entry.createdDuringRun) {
          deleteEntry(entry)
        }
      }
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
