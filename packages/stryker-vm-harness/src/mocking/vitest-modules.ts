import * as Effect from 'effect/Effect'

import { hasDynamicImport, MOCK_GLOBAL_KEY } from '../mock-module.js'
import { nativeImport } from '../native-import.js'
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

interface ImportSite {
  readonly start: number
  readonly sourceStart: number
  readonly end: number
}

const isNonNullObject = (value: unknown): value is object => typeof value === 'object' && value !== null

const isNonArrayObject = (value: ImportExpressionChild): value is ImportExpressionSource | ImportExpressionNode =>
  isNonNullObject(value) && !Array.isArray(value)

const isImportExpressionNode = (value: ImportExpressionChild): value is ImportExpressionNode =>
  isNonArrayObject(value) && 'type' in value

const visitNode = (
  node: ImportExpressionNode,
  visit: (node: ImportExpressionNode) => void,
  visitRecord: (record: Record<string, ImportExpressionChild>) => void,
): void => {
  if (node['type'] === 'ImportExpression') {
    visitImportExpression(node, visit)
    return
  }
  visitRecord(node)
}

const visitImportExpression = (
  node: ImportExpressionNode,
  visit: (node: ImportExpressionNode) => void,
): void => {
  if (node.source !== undefined) {
    visit(node)
  }
}

const isChildArray = (value: ImportExpressionChild): value is ReadonlyArray<ImportExpressionChild> =>
  Array.isArray(value)

const visitChildren = (
  values: ReadonlyArray<ImportExpressionChild>,
  visit: (node: ImportExpressionNode) => void,
  visitRecord: (record: Record<string, ImportExpressionChild>) => void,
): void => {
  for (const item of values) {
    visitChild(item, visit, visitRecord)
  }
}

const visitChild = (
  value: ImportExpressionChild,
  visit: (node: ImportExpressionNode) => void,
  visitRecord: (record: Record<string, ImportExpressionChild>) => void,
): void => {
  if (isChildArray(value)) {
    visitChildren(value, visit, visitRecord)
    return
  }
  visitSingleChild(value, visit, visitRecord)
}

const visitSingleChild = (
  value: ImportExpressionChild,
  visit: (node: ImportExpressionNode) => void,
  visitRecord: (record: Record<string, ImportExpressionChild>) => void,
): void => {
  if (isImportExpressionNode(value)) {
    visitNode(value, visit, visitRecord)
  }
}

const collectImportExpressions = (root: ImportExpressionNode, visit: (node: ImportExpressionNode) => void): void => {
  const visitRecord = (record: Record<string, ImportExpressionChild>): void => {
    for (const key of Object.keys(record)) {
      visitChild(record[key], visit, visitRecord)
    }
  }
  visitNode(root, visit, visitRecord)
}

const isImportExpressionNodeObject = (value: object): value is ImportExpressionNode =>
  'start' in value && 'end' in value

const asImportExpressionNode = (value: object): ImportExpressionNode | undefined =>
  isImportExpressionNodeObject(value) ? value : undefined

const parsedRootOf = (parse: MockParse, code: string): ImportExpressionNode | undefined => {
  try {
    return asImportExpressionNode(parse(code))
  } catch {
    return undefined
  }
}

const injectDynamicImportWraps = (
  code: string,
  parse: MockParse,
  options: HoistMocksOptions,
): string | undefined => shouldInject(code) ? injectedSource(parsedRootOf(parse, code), code, options) : undefined

const shouldInject = (code: string): boolean => hasDynamicImport(code) && !code.includes(WRAP_GUARD)

const injectedSource = (
  root: ImportExpressionNode | undefined,
  code: string,
  options: HoistMocksOptions,
): string | undefined => (root === undefined ? undefined : rewrittenWithWraps(root, code, options))

const rewrittenWithWraps = (
  root: ImportExpressionNode,
  code: string,
  options: HoistMocksOptions,
): string | undefined => {
  const sites: ImportSite[] = []
  collectImportExpressions(root, (node) => {
    if (node.source !== undefined) {
      sites.push({ start: node.start, sourceStart: node.source.start, end: node.end })
    }
  })
  if (sites.length === 0) {
    return undefined
  }
  return rewriteSites(sites, code, options)
}

const rewriteSites = (sites: ReadonlyArray<ImportSite>, code: string, options: HoistMocksOptions): string => {
  const accessor = options.globalThisAccessor ?? JSON.stringify(MOCK_GLOBAL_KEY)
  const ordered = [...sites].sort((left, right) => right.start - left.start)
  return ordered.reduce((rewritten, site) => wrapSite(rewritten, site, accessor), code)
}

const wrapSite = (rewritten: string, site: ImportSite, accessor: string): string =>
  `${rewritten.slice(0, site.start)}globalThis[${accessor}].wrapDynamicImport(async () => import(${
    rewritten.slice(site.sourceStart, site.end - 1)
  }))${rewritten.slice(site.end)}`

const hoistedSourceOf = (hoisted: MockMagicString | undefined, code: string): string =>
  hoisted === undefined ? code : hoisted.toString()

const generateMapOf = (hoisted: MockMagicString | undefined): (options: object) => object =>
  hoisted === undefined ? (): object => ({}) : (mapOptions: object): object => hoisted.generateMap(mapOptions)

const wrappedMagicString = (wrapped: string, hoisted: MockMagicString | undefined): MockMagicString => ({
  toString: (): string => wrapped,
  generateMap: generateMapOf(hoisted),
})

const injectedHoistMocks = (
  transforms: MockerTransforms,
  code: string,
  id: string,
  parse: MockParse,
  options: HoistMocksOptions,
): MockMagicString | undefined => {
  const hoisted = transforms.hoistMocks(code, id, parse, options)
  const wrapped = injectDynamicImportWraps(hoistedSourceOf(hoisted, code), parse, options)
  return wrapped === undefined ? hoisted : wrappedMagicString(wrapped, hoisted)
}

const withDynamicImportInjection = (transforms: MockerTransforms): MockerTransforms => ({
  ...transforms,
  hoistMocksWithDynamicImports: (code, id, parse, options) => injectedHoistMocks(transforms, code, id, parse, options),
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
