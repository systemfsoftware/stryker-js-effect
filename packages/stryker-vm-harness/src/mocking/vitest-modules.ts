import * as Effect from 'effect/Effect'

import { hasDynamicImport, MOCK_GLOBAL_KEY } from '../mock-module.js'
import { nativeImport } from '../native-import.handle.js'
import { createRequire, pathToFileURL } from './node-builtins.js'

export interface MockMagicString {
  readonly toString: () => string
  readonly generateMap: (options: object) => object
}

export type MockParse = (code: string) => object

export interface HoistMocksOptions {
  readonly globalThisAccessor?: string
}

export interface GlobalConstructors {
  readonly Object: ObjectConstructor
  readonly Error: ErrorConstructor
  readonly Function: FunctionConstructor
  readonly RegExp: RegExpConstructor
  readonly Symbol: SymbolConstructor
  readonly Array: ArrayConstructor
  readonly Map: MapConstructor
}

export interface MockObjectOptions {
  readonly type: 'automock' | 'autospy'
  readonly globalConstructors: GlobalConstructors
  readonly createMockInstance: CreateMockInstance
}

export type CreateMockInstance = (options?: object) => object

export interface MockerTransforms {
  readonly hoistMocks: (
    code: string,
    id: string,
    parse: MockParse,
    options: HoistMocksOptions,
  ) => MockMagicString | undefined
  readonly hoistMocksWithDynamicImports: (
    code: string,
    id: string,
    parse: MockParse,
    options: HoistMocksOptions,
  ) => MockMagicString | undefined
  readonly automockModule: (
    code: string,
    mockType: 'automock' | 'autospy',
    parse: MockParse,
    options?: { readonly globalThisAccessor?: string; readonly id?: string },
  ) => MockMagicString
  readonly collectModuleExports: (filename: string, code: string, format: 'module' | 'commonjs') => readonly string[]
  readonly initSyntaxLexers: () => Promise<void>
}

export interface MockerGlobals {
  readonly mockObject: (options: MockObjectOptions, object: object, mockExports?: object) => object
}

export interface MockerRedirect {
  readonly findMockRedirect: (root: string, mockPath: string, external: boolean) => string | null
}

export interface MockerSpy {
  readonly createMockInstance: CreateMockInstance
}

export interface MockerVite {
  readonly parseAst: (sourceText: string, options?: object, filename?: string) => object
}

export interface VitestMockerModules {
  readonly transforms: MockerTransforms
  readonly globals: MockerGlobals
  readonly redirect: MockerRedirect
  readonly spy: MockerSpy
  readonly parse: MockParse
}

const WRAP_GUARD = 'wrapDynamicImport'

interface ImportExpressionSource {
  readonly start: number
  readonly end: number
}

type ImportExpressionChild =
  | string
  | number
  | boolean
  | null
  | undefined
  | ImportExpressionSource
  | ImportExpressionNode
  | ReadonlyArray<ImportExpressionChild>

interface ImportExpressionNode {
  readonly start: number
  readonly end: number
  readonly source?: ImportExpressionSource
  readonly [key: string]: ImportExpressionChild
}

const collectImportExpressions = (root: object, visit: (node: ImportExpressionNode) => void): void => {
  const visitRecord = (record: Record<string, ImportExpressionChild>): void => {
    for (const key of Object.keys(record)) {
      visitChild(record[key])
    }
  }
  const visitChild = (value: ImportExpressionChild): void => {
    if (Array.isArray(value)) {
      for (const item of value as ReadonlyArray<ImportExpressionChild>) {
        visitChild(item)
      }
      return
    }
    if (typeof value !== 'object' || value === null || !('type' in value)) {
      return
    }
    const node = value as ImportExpressionNode & { readonly type: string }
    if (node.type === 'ImportExpression') {
      if (node.source !== undefined) {
        visit(node)
      }
      return
    }
    visitRecord(node)
  }
  visitChild(root as ImportExpressionChild)
}

const injectDynamicImportWraps = (
  code: string,
  id: string,
  parse: MockParse,
  options: HoistMocksOptions,
): string | undefined => {
  if (!hasDynamicImport(code) || code.includes(WRAP_GUARD)) {
    return undefined
  }
  let root: object
  try {
    root = parse(code)
  } catch {
    return undefined
  }
  const sites: Array<{ readonly start: number; readonly sourceStart: number; readonly end: number }> = []
  collectImportExpressions(root, (node) => {
    if (node.source !== undefined) {
      sites.push({ start: node.start, sourceStart: node.source.start, end: node.end })
    }
  })
  if (sites.length === 0) {
    return undefined
  }
  const accessor = options.globalThisAccessor ?? JSON.stringify(MOCK_GLOBAL_KEY)
  const ordered = [...sites].sort((left, right) => right.start - left.start)
  let rewritten = code
  for (const site of ordered) {
    rewritten = `${rewritten.slice(0, site.start)}globalThis[${accessor}].wrapDynamicImport(async () => import(${
      rewritten.slice(site.sourceStart, site.end - 1)
    }))${rewritten.slice(site.end)}`
  }
  return rewritten
}

const withDynamicImportInjection = (transforms: MockerTransforms): MockerTransforms => ({
  ...transforms,
  hoistMocksWithDynamicImports: (code, id, parse, options) => {
    const hoisted = transforms.hoistMocks(code, id, parse, options)
    const base = hoisted === undefined ? code : hoisted.toString()
    const wrapped = injectDynamicImportWraps(base, id, parse, options)
    if (wrapped === undefined) {
      return hoisted
    }
    const generateMap = hoisted === undefined
      ? (_mapOptions: object): object => ({})
      : (mapOptions: object): object => hoisted.generateMap(mapOptions)
    return { toString: (): string => wrapped, generateMap }
  },
})

const moduleCache = new Map<string, Promise<VitestMockerModules>>()
const loadVitestMockerModulesEffect = (vitestPackageJsonPath: string): Effect.Effect<VitestMockerModules> =>
  Effect.gen(function*() {
    const fromVitest = createRequire(vitestPackageJsonPath)
    const fromMocker = createRequire(fromVitest.resolve('@vitest/mocker/package.json'))
    const transforms = yield* Effect.promise(() =>
      nativeImport<MockerTransforms>(pathToFileURL(fromMocker.resolve('@vitest/mocker/transforms')).href)
    )
    const globals = yield* Effect.promise(() =>
      nativeImport<MockerGlobals>(pathToFileURL(fromMocker.resolve('@vitest/mocker')).href)
    )
    const redirect = yield* Effect.promise(() =>
      nativeImport<MockerRedirect>(pathToFileURL(fromMocker.resolve('@vitest/mocker/redirect')).href)
    )
    const spy = yield* Effect.promise(() =>
      nativeImport<MockerSpy>(pathToFileURL(fromMocker.resolve('@vitest/spy')).href)
    )
    const vite = yield* Effect.promise(
      (): Promise<MockerVite> => import(pathToFileURL(fromVitest.resolve('vite')).href),
    )
    yield* Effect.promise(() => transforms.initSyntaxLexers())
    return {
      transforms: withDynamicImportInjection(transforms),
      globals,
      redirect,
      spy,
      parse: (code: string): object => vite.parseAst(code, { lang: 'js' }, 'vmrunner-mock-source.js'),
    }
  })

export const loadVitestMockerModules = (vitestPackageJsonPath: string): Promise<VitestMockerModules> => {
  const cached = moduleCache.get(vitestPackageJsonPath)
  if (cached !== undefined) {
    return cached
  }
  const loaded = Effect.runPromise(loadVitestMockerModulesEffect(vitestPackageJsonPath))
  moduleCache.set(vitestPackageJsonPath, loaded)
  void loaded.catch(() => {
    if (moduleCache.get(vitestPackageJsonPath) === loaded) {
      moduleCache.delete(vitestPackageJsonPath)
    }
  })
  return loaded
}
