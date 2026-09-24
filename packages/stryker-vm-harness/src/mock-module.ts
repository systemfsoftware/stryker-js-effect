import { dual } from 'effect/Function'

import { type MockModuleSourceSpec, type MockRequestKind } from './mock-registry.schema.js'

export const MOCK_GLOBAL_KEY = '__vitest_mocker__'

export const MOCK_NAMESPACE_MARKER = '__stryker_vm_mock_raw__'

const HOISTABLE_MOCK_API = /\b(?:vi|vitest)\s*\.\s*(?:mock|unmock|hoisted|doMock|doUnmock)\s*\(/

const MOCK_URL_SCHEME = 'vmrunner-mock:'
const ACTUAL_QUERY = 'stryker-actual=1'
const MOCK_LOAD_QUERY = 'stryker-mock'

export type MockLoadKind = 'automock' | 'autospy'

export type MockFactory = (importOriginal: () => Promise<object>) => object | Promise<object>

export type MockFactoryOrOptions = MockFactory | { readonly spy?: boolean }

const querySeparatorOf = (url: string): string => (url.includes('?') ? '&' : '?')

const queryMarkerAt = (url: string, marker: string): number => {
  const queryAt = url.indexOf(`?${marker}`)
  return queryAt === -1 ? url.indexOf(`&${marker}`) : queryAt
}

const sliceToDelimiter = (url: string, start: number, end: number): string =>
  url.slice(start, end === -1 ? undefined : end)

const queryValueOf = (url: string, key: string): string | undefined => {
  const marker = `${key}=`
  const at = queryMarkerAt(url, marker)
  if (at === -1) {
    return undefined
  }
  const valueStart = at + marker.length + 1
  return sliceToDelimiter(url, valueStart, url.indexOf('&', valueStart))
}

export const cleanModuleUrl = (url: string): string => {
  const queryAt = url.search(/[?#]/)
  return queryAt === -1 ? url : url.slice(0, queryAt)
}

export const mockKeyOf = dual<
  (resolvedUrl: string) => (salt: string) => string,
  (salt: string, resolvedUrl: string) => string
>(2, (salt, resolvedUrl) => `${salt}::${cleanModuleUrl(resolvedUrl)}`)

export const saltOfUrl = (url: string): string | undefined => queryValueOf(url, 'salt')

export const withSaltQuery = dual<
  (salt: string) => (url: string) => string,
  (url: string, salt: string) => string
>(2, (url, salt) => (saltOfUrl(url) === undefined ? `${url}${querySeparatorOf(url)}salt=${salt}` : url))

const withoutParam = (url: string, at: number): string => {
  const head = url.slice(0, at)
  const next = url.indexOf('&', at + 1)
  return next === -1 ? head : `${head}${querySeparatorOf(head)}${url.slice(next + 1)}`
}

export const stripSaltQueryOf = (url: string): string => {
  const at = url.search(/[?&]salt=/)
  return at === -1 ? url : withoutParam(url, at)
}

export const mockGenerationOfUrl = (url: string): string | undefined => queryValueOf(url, 'stryker-mock-gen')

export const withMockGenerationQuery = dual<
  (generation: string) => (url: string) => string,
  (url: string, generation: string) => string
>(
  2,
  (url, generation) =>
    mockGenerationOfUrl(url) === undefined ? `${url}${querySeparatorOf(url)}stryker-mock-gen=${generation}` : url,
)

export const stripMockGenerationQueryOf = (url: string): string => {
  const at = url.search(/[?&]stryker-mock-gen=/)
  return at === -1 ? url : withoutParam(url, at)
}

export const mockModuleUrl = dual<
  (entryId: string) => (salt: string) => string,
  (salt: string, entryId: string) => string
>(2, (salt, entryId) => `${MOCK_URL_SCHEME}${encodeURIComponent(salt)}:${encodeURIComponent(entryId)}`)

interface MockModuleUrl {
  readonly salt: string
  readonly entryId: string
}

const isUsableSeparator = (opaque: string, at: number): boolean => at > 0 && at < opaque.length - 1

const entrySeparatorAt = (opaque: string): number => {
  const at = opaque.lastIndexOf(':')
  return isUsableSeparator(opaque, at) ? at : -1
}

const decodeMockPair = (opaque: string, at: number): MockModuleUrl | undefined => {
  try {
    return {
      salt: decodeURIComponent(opaque.slice(0, at)),
      entryId: decodeURIComponent(opaque.slice(at + 1)),
    }
  } catch {
    return undefined
  }
}

const parseOpaqueMockUrl = (opaque: string): MockModuleUrl | undefined => {
  const at = entrySeparatorAt(opaque)
  return at === -1 ? undefined : decodeMockPair(opaque, at)
}

export const parseMockModuleUrl = (url: string): MockModuleUrl | undefined =>
  url.startsWith(MOCK_URL_SCHEME) ? parseOpaqueMockUrl(url.slice(MOCK_URL_SCHEME.length)) : undefined

const entryIdOfUrl = (url: string): string | undefined => parseMockModuleUrl(url)?.entryId

export const mockResolutionEntryIdOf = (resolved: string): string | undefined => {
  const at = resolved.lastIndexOf(MOCK_URL_SCHEME)
  return at === -1 ? undefined : entryIdOfUrl(cleanModuleUrl(resolved.slice(at)))
}

export const hasActualQuery = (specifier: string): boolean => specifier.includes(ACTUAL_QUERY)

export const stripActualQuery = (specifier: string): string =>
  specifier.replace(`&${ACTUAL_QUERY}`, '').replace(`?${ACTUAL_QUERY}`, '')

export const actualUrlOf = (resolvedUrl: string): string =>
  `${resolvedUrl}${querySeparatorOf(resolvedUrl)}${ACTUAL_QUERY}`

export const mockLoadUrlOf = dual<
  (kind: MockLoadKind) => (resolvedUrl: string) => string,
  (resolvedUrl: string, kind: MockLoadKind) => string
>(2, (resolvedUrl, kind) => `${resolvedUrl}${querySeparatorOf(resolvedUrl)}${MOCK_LOAD_QUERY}=${kind}`)

const isMockLoadKind = (kind: string | undefined): kind is MockLoadKind => kind === 'automock' || kind === 'autospy'

export const mockLoadKindOfUrl = (url: string): MockLoadKind | undefined => {
  const kind = queryValueOf(url, MOCK_LOAD_QUERY)
  return isMockLoadKind(kind) ? kind : undefined
}

export const stripMockLoadQuery = (url: string): string =>
  url.replace(new RegExp(`[?&]${MOCK_LOAD_QUERY}=(?:automock|autospy)`), '')

const isInternalUrl = (url: string): boolean => url.includes('/node_modules/') || url.includes('/vitest/dist/')

export const resettableUrl = (url: string): boolean => url.startsWith('file://') && !isInternalUrl(url)

const isResettableGeneration = (resolvedUrl: string, generation: number): boolean =>
  generation > 0 && resettableUrl(resolvedUrl)

const generationSuffixOf = (unsalted: string, existing: string | undefined, generation: number): string => {
  const stripped = existing === undefined ? unsalted : unsalted.replace(`stryker-gen=${existing}`, '')
  return `${stripped}${querySeparatorOf(stripped)}stryker-gen=${generation}`
}

const withSaltQueryIfAny = (salt: string | undefined, url: string): string =>
  salt === undefined ? url : withSaltQuery(url, salt)

const freshUrlOf = (resolvedUrl: string, generation: number): string => {
  const unsalted = stripSaltQueryOf(resolvedUrl)
  const existing = queryValueOf(unsalted, 'stryker-gen')
  return existing === String(generation)
    ? resolvedUrl
    : withSaltQueryIfAny(saltOfUrl(resolvedUrl), generationSuffixOf(unsalted, existing, generation))
}

export const freshModuleUrlOf = dual<
  (generation: number) => (resolvedUrl: string) => string,
  (resolvedUrl: string, generation: number) => string
>(
  2,
  (resolvedUrl, generation) =>
    isResettableGeneration(resolvedUrl, generation) ? freshUrlOf(resolvedUrl, generation) : resolvedUrl,
)

export const shouldHoistSource = (source: string): boolean => HOISTABLE_MOCK_API.test(source)

const DYNAMIC_IMPORT = /\bimport\s*\(/

export const hasDynamicImport = (source: string): boolean => DYNAMIC_IMPORT.test(source)

const isSpyOptions = (factoryOrOptions: MockFactoryOrOptions | undefined): boolean =>
  typeof factoryOrOptions === 'object' && factoryOrOptions.spy === true

const optionsKindOf = (factoryOrOptions: MockFactoryOrOptions | undefined): MockRequestKind =>
  isSpyOptions(factoryOrOptions) ? 'autospy' : 'automock'

export const mockKindOf = (factoryOrOptions: MockFactoryOrOptions | undefined): MockRequestKind =>
  typeof factoryOrOptions === 'function' ? 'manual' : optionsKindOf(factoryOrOptions)

const escapeForSource = (name: string): string => name.replace(/\\/g, '\\\\').replace(/"/g, '\\"')

export const renderMockModuleSource = (spec: MockModuleSourceSpec): string => {
  const bindings = spec.exportNames
    .map(
      (name, index) =>
        `let __mock_export_${index}__ = __strykerMockModule__["${
          escapeForSource(name)
        }"]\nexport { __mock_export_${index}__ as "${escapeForSource(name)}" }`,
    )
    .join('\n')
  return [
    `const __strykerMockModule__ = await globalThis[${JSON.stringify(MOCK_GLOBAL_KEY)}].getFactoryModule(${
      JSON.stringify(spec.entryId)
    })`,
    bindings,
    `export const ${MOCK_NAMESPACE_MARKER} = ${JSON.stringify(spec.raw)}`,
  ]
    .filter((line) => line.length > 0)
    .join('\n')
}

export const missingExportMessage = dual<
  (rawSpecifier: string) => (exportName: string) => string,
  (exportName: string, rawSpecifier: string) => string
>(
  2,
  (exportName, rawSpecifier) =>
    `[vitest] No "${exportName}" export is defined on the "${rawSpecifier}" mock. Did you forget to return it from "vi.mock"?\nIf you need to partially mock a module, you can use "importOriginal" helper inside:\n\nvi.mock(import("${rawSpecifier}"), async (importOriginal) => {\n  const actual = await importOriginal()\n  return {\n    ...actual,\n    // your mocked methods\n  }\n})`,
)

export const extensionFallbacksOf = (specifier: string): ReadonlyArray<string> =>
  specifier.endsWith('.js') ? [`${specifier.slice(0, -3)}.ts`, `${specifier.slice(0, -3)}.tsx`] : []
