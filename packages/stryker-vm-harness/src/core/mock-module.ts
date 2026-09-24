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

const queryValueOf = (url: string, key: string): string | undefined => {
  const marker = `${key}=`
  const at = url.indexOf(`?${marker}`) === -1 ? url.indexOf(`&${marker}`) : url.indexOf(`?${marker}`)
  if (at === -1) {
    return undefined
  }
  const valueStart = at + marker.length + 1
  const end = url.indexOf('&', valueStart)
  return url.slice(valueStart, end === -1 ? undefined : end)
}

export const cleanModuleUrl = (url: string): string => {
  const queryAt = url.search(/[?#]/)
  return queryAt === -1 ? url : url.slice(0, queryAt)
}

export const mockKeyOf = (salt: string, resolvedUrl: string): string => `${salt}::${cleanModuleUrl(resolvedUrl)}`

export const saltOfUrl = (url: string): string | undefined => queryValueOf(url, 'salt')

export const withSaltQuery = (url: string, salt: string): string =>
  saltOfUrl(url) === undefined ? `${url}${querySeparatorOf(url)}salt=${salt}` : url

export const stripSaltQueryOf = (url: string): string => {
  const at = url.search(/[?&]salt=/)
  if (at === -1) {
    return url
  }
  const next = url.indexOf('&', at + 1)
  const head = url.slice(0, at)
  if (next === -1) {
    return head
  }
  return `${head}${head.includes('?') ? '&' : '?'}${url.slice(next + 1)}`
}

export const mockGenerationOfUrl = (url: string): string | undefined => queryValueOf(url, 'stryker-mock-gen')

export const withMockGenerationQuery = (url: string, generation: string): string =>
  mockGenerationOfUrl(url) === undefined ? `${url}${querySeparatorOf(url)}stryker-mock-gen=${generation}` : url

export const stripMockGenerationQueryOf = (url: string): string => {
  const at = url.search(/[?&]stryker-mock-gen=/)
  if (at === -1) {
    return url
  }
  const next = url.indexOf('&', at + 1)
  const head = url.slice(0, at)
  if (next === -1) {
    return head
  }
  return `${head}${head.includes('?') ? '&' : '?'}${url.slice(next + 1)}`
}

export const mockModuleUrl = (salt: string, entryId: string): string =>
  `${MOCK_URL_SCHEME}${encodeURIComponent(salt)}:${encodeURIComponent(entryId)}`

export const parseMockModuleUrl = (url: string): { readonly salt: string; readonly entryId: string } | undefined => {
  if (!url.startsWith(MOCK_URL_SCHEME)) {
    return undefined
  }
  const opaque = url.slice(MOCK_URL_SCHEME.length)
  const entryAt = opaque.lastIndexOf(':')
  if (entryAt <= 0 || entryAt === opaque.length - 1) {
    return undefined
  }
  try {
    return {
      salt: decodeURIComponent(opaque.slice(0, entryAt)),
      entryId: decodeURIComponent(opaque.slice(entryAt + 1)),
    }
  } catch {
    return undefined
  }
}

export const mockResolutionEntryIdOf = (resolved: string): string | undefined => {
  const at = resolved.lastIndexOf(MOCK_URL_SCHEME)
  if (at === -1) {
    return undefined
  }
  return parseMockModuleUrl(cleanModuleUrl(resolved.slice(at)))?.entryId
}

export const hasActualQuery = (specifier: string): boolean => specifier.includes(ACTUAL_QUERY)

export const stripActualQuery = (specifier: string): string =>
  specifier.replace(`&${ACTUAL_QUERY}`, '').replace(`?${ACTUAL_QUERY}`, '')

export const actualUrlOf = (resolvedUrl: string): string =>
  `${resolvedUrl}${querySeparatorOf(resolvedUrl)}${ACTUAL_QUERY}`

export const mockLoadUrlOf = (resolvedUrl: string, kind: MockLoadKind): string =>
  `${resolvedUrl}${querySeparatorOf(resolvedUrl)}${MOCK_LOAD_QUERY}=${kind}`

export const mockLoadKindOfUrl = (url: string): MockLoadKind | undefined => {
  if (!url.includes(MOCK_LOAD_QUERY)) {
    return undefined
  }
  const kind = queryValueOf(url, MOCK_LOAD_QUERY)
  return kind === 'automock' || kind === 'autospy' ? kind : undefined
}

export const stripMockLoadQuery = (url: string): string =>
  url.replace(new RegExp(`[?&]${MOCK_LOAD_QUERY}=(?:automock|autospy)`), '')

export const resettableUrl = (url: string): boolean =>
  url.startsWith('file://') && !url.includes('/node_modules/') && !url.includes('/vitest/dist/')

export const freshModuleUrlOf = (resolvedUrl: string, generation: number): string => {
  if (generation <= 0 || !resettableUrl(resolvedUrl)) {
    return resolvedUrl
  }
  const salt = saltOfUrl(resolvedUrl)
  const unsalted = stripSaltQueryOf(resolvedUrl)
  const existing = queryValueOf(unsalted, 'stryker-gen')
  if (existing === String(generation)) {
    return resolvedUrl
  }
  const stripped = existing === undefined ? unsalted : unsalted.replace(`stryker-gen=${existing}`, '')
  const fresh = `${stripped}${querySeparatorOf(stripped)}stryker-gen=${generation}`
  return salt === undefined ? fresh : withSaltQuery(fresh, salt)
}

export const shouldHoistSource = (source: string): boolean => HOISTABLE_MOCK_API.test(source)

const DYNAMIC_IMPORT = /\bimport\s*\(/

export const hasDynamicImport = (source: string): boolean => DYNAMIC_IMPORT.test(source)

export const mockKindOf = (factoryOrOptions: MockFactoryOrOptions | undefined): MockRequestKind => {
  if (typeof factoryOrOptions === 'function') {
    return 'manual'
  }
  if (factoryOrOptions !== undefined && factoryOrOptions.spy === true) {
    return 'autospy'
  }
  return 'automock'
}

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

export const missingExportMessage = (exportName: string, rawSpecifier: string): string =>
  `[vitest] No "${exportName}" export is defined on the "${rawSpecifier}" mock. Did you forget to return it from "vi.mock"?\nIf you need to partially mock a module, you can use "importOriginal" helper inside:\n\nvi.mock(import("${rawSpecifier}"), async (importOriginal) => {\n  const actual = await importOriginal()\n  return {\n    ...actual,\n    // your mocked methods\n  }\n})`

export const extensionFallbacksOf = (specifier: string): ReadonlyArray<string> =>
  specifier.endsWith('.js') ? [`${specifier.slice(0, -3)}.ts`, `${specifier.slice(0, -3)}.tsx`] : []
