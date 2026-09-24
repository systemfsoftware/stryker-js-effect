import * as Option from 'effect/Option'
import * as Predicate from 'effect/Predicate'
import * as S from 'effect/Schema'

import type { Json } from 'effect/Schema'

import type { VmProjectConfig, VmTagDefinition, VmVitestConfig } from '../vitest-config.schema.js'
import { defaultProjectConfig } from './defaults.js'

type ArbitraryValue = string | number | boolean | null | object

export type ArbitraryRecord = Readonly<Record<string, ArbitraryValue>>

export interface VitestAliasView {
  readonly find: string | { readonly source: string; readonly flags: string }
  readonly replacement: string
}

type AliasConfigView = ReadonlyArray<VitestAliasView> | Readonly<Record<string, string>>

export interface VitestProjectConfigView {
  readonly name?: string
  readonly root: string
  readonly include?: ReadonlyArray<string>
  readonly exclude?: ReadonlyArray<string>
  readonly includeSource?: ReadonlyArray<string>
  readonly setupFiles?: ReadonlyArray<string>
  readonly globals?: boolean
  readonly environment?: string
  readonly environmentOptions?: ArbitraryRecord
  readonly isolate?: boolean
  readonly testTimeout?: number
  readonly hookTimeout?: number
  readonly retry?: number | object
  readonly repeats?: number
  readonly maxConcurrency?: number
  readonly restoreMocks?: boolean
  readonly clearMocks?: boolean
  readonly mockReset?: boolean
  readonly unstubGlobals?: boolean
  readonly unstubEnvs?: boolean
  readonly snapshotFormat?: ArbitraryRecord
  readonly snapshotSerializers?: ReadonlyArray<string>
  readonly fakeTimers?: ArbitraryRecord
  readonly expect?: {
    readonly requireAssertions?: boolean
    readonly poll?: { readonly timeout?: number; readonly interval?: number }
  }
  readonly define?: ArbitraryRecord
  readonly defines?: ArbitraryRecord
  readonly env?: ArbitraryRecord
  readonly alias?: AliasConfigView
  readonly provide?: ArbitraryRecord
  readonly testNamePattern?: RegExp | string
  readonly globalSetup?: ReadonlyArray<string>
  readonly injectCjsGlobals?: boolean
  readonly tags?: ReadonlyArray<ArbitraryRecord>
  readonly strictTags?: boolean
  readonly sequence?: {
    readonly concurrent?: boolean
    readonly shuffle?: boolean
    readonly seed?: number
    readonly hooks?: string
    readonly setupFiles?: string
  }
  readonly allowOnly?: boolean
}

export interface VitestProjectView {
  readonly name: string
  readonly browserEnabled: boolean
  readonly config: VitestProjectConfigView
  readonly viteEnv: ArbitraryRecord | undefined
  readonly serverConditions: ReadonlyArray<string> | undefined
}

export interface VitestRootView {
  readonly configFile?: string
  readonly provide?: ArbitraryRecord | undefined
  readonly envSeeds?: ArbitraryRecord
  readonly projects: ReadonlyArray<VitestProjectView>
}

const propertyOf = <A = unknown>(row: A, key: string): A | undefined =>
  Predicate.isObject(row) ? Object.getOwnPropertyDescriptor(row, key)?.value : undefined

const jsonEntriesOf = <A = unknown>(value: A): Record<string, Json> => {
  if (!Predicate.isObject(value)) return {}
  const out: Record<string, Json> = {}
  for (const key of Object.keys(value)) {
    const decoded = Option.getOrElse(S.decodeUnknownOption(S.Json)(propertyOf(value, key)), () => undefined)
    if (decoded !== undefined) out[key] = decoded
  }
  return out
}

const stringEntriesOf = <A = unknown>(value: A): Record<string, string> => {
  const entries = jsonEntriesOf(value)
  const out: Record<string, string> = {}
  for (const key of Object.keys(entries)) {
    const entry = entries[key]
    if (typeof entry === 'string') out[key] = entry
  }
  return out
}

const listOf = (value: ReadonlyArray<string> | undefined): ReadonlyArray<string> => value ?? []

const aliasFindOf = (find: VitestAliasView['find']): VmProjectConfig['alias'][number]['find'] =>
  typeof find === 'string' ? find : { source: find.source, flags: find.flags }

const isAliasRecord = (value: AliasConfigView): value is Readonly<Record<string, string>> => !Array.isArray(value)

const aliasListOf = (value: AliasConfigView | undefined): ReadonlyArray<VitestAliasView> => {
  if (value === undefined) return []
  if (isAliasRecord(value)) {
    return Object.keys(value).flatMap((find): VitestAliasView[] => {
      const replacement = value[find]
      return replacement === undefined ? [] : [{ find, replacement }]
    })
  }
  return value.map(({ find, replacement }) => ({ find: aliasFindOf(find), replacement }))
}

const hooksOf = (value: string | undefined): 'stack' | 'list' | 'parallel' =>
  value === 'list' || value === 'parallel' ? value : 'stack'

const setupFilesOrderOf = (value: string | undefined): 'list' | 'parallel' => (value === 'list' ? 'list' : 'parallel')

const namePatternOf = (pattern: RegExp | string): NonNullable<VmProjectConfig['testNamePattern']> =>
  typeof pattern === 'string' ? { source: pattern, flags: '' } : { source: pattern.source, flags: pattern.flags }

const tagOf = (definition: ArbitraryRecord): VmTagDefinition => {
  const options: Record<string, Json> = {}
  for (const key of Object.keys(definition)) {
    if (key === 'name' || key === 'description') continue
    const decoded = Option.getOrElse(S.decodeUnknownOption(S.Json)(propertyOf(definition, key)), () => undefined)
    if (decoded !== undefined) options[key] = decoded
  }
  const name = propertyOf(definition, 'name')
  const description = propertyOf(definition, 'description')
  return {
    name: typeof name === 'string' ? name : '',
    ...(typeof description === 'string' ? { description } : {}),
    options,
  }
}

export const extractProjectConfig = (
  view: VitestProjectConfigView,
  viteEnv: ArbitraryRecord | undefined,
  serverConditions: ReadonlyArray<string> | undefined,
  rootProvide?: ArbitraryRecord,
  hostEnvSeeds?: ArbitraryRecord,
): VmProjectConfig => {
  const base = defaultProjectConfig(view.root)
  return {
    name: view.name ?? base.name,
    root: view.root,
    include: listOf(view.include),
    exclude: listOf(view.exclude),
    includeSource: listOf(view.includeSource),
    setupFiles: listOf(view.setupFiles),
    globals: view.globals ?? base.globals,
    environment: view.environment ?? base.environment,
    environmentOptions: jsonEntriesOf(view.environmentOptions),
    isolate: view.isolate ?? base.isolate,
    testTimeout: view.testTimeout ?? base.testTimeout,
    hookTimeout: view.hookTimeout ?? base.hookTimeout,
    retry: typeof view.retry === 'number' ? view.retry : 0,
    repeats: typeof view.repeats === 'number' ? view.repeats : 0,
    maxConcurrency: view.maxConcurrency ?? base.maxConcurrency,
    restoreMocks: view.restoreMocks ?? base.restoreMocks,
    clearMocks: view.clearMocks ?? base.clearMocks,
    mockReset: view.mockReset ?? base.mockReset,
    unstubGlobals: view.unstubGlobals ?? base.unstubGlobals,
    unstubEnvs: view.unstubEnvs ?? base.unstubEnvs,
    snapshotFormat: jsonEntriesOf(view.snapshotFormat),
    snapshotSerializers: listOf(view.snapshotSerializers),
    fakeTimers: jsonEntriesOf(view.fakeTimers),
    expect: {
      requireAssertions: view.expect?.requireAssertions ?? base.expect.requireAssertions,
      poll: {
        timeout: view.expect?.poll?.timeout ?? base.expect.poll.timeout,
        interval: view.expect?.poll?.interval ?? base.expect.poll.interval,
      },
    },
    define: { ...jsonEntriesOf(view.define), ...jsonEntriesOf(view.defines) },
    env: { ...stringEntriesOf(viteEnv), ...stringEntriesOf(view.env), ...stringEntriesOf(hostEnvSeeds) },
    alias: aliasListOf(view.alias).map(({ find, replacement }) => ({ find: aliasFindOf(find), replacement })),
    conditions: serverConditions ?? [],
    ...(view.testNamePattern !== undefined ? { testNamePattern: namePatternOf(view.testNamePattern) } : {}),
    globalSetup: listOf(view.globalSetup),
    injectCjsGlobals: view.injectCjsGlobals ?? true,
    tags: (view.tags ?? []).map(tagOf),
    strictTags: view.strictTags ?? true,
    ...(view.allowOnly === undefined ? {} : { allowOnly: view.allowOnly }),
    sequence: {
      concurrent: view.sequence?.concurrent ?? false,
      shuffle: view.sequence?.shuffle ?? false,
      ...(typeof view.sequence?.seed === 'number' ? { seed: view.sequence.seed } : {}),
      hooks: hooksOf(view.sequence?.hooks),
      setupFiles: setupFilesOrderOf(view.sequence?.setupFiles),
    },
    ...provideSpreadOf(view.provide, rootProvide),
  }
}

const provideSpreadOf = (
  project: ArbitraryRecord | undefined,
  root: ArbitraryRecord | undefined,
): { readonly provide?: Record<string, Json> } => {
  const merged = { ...jsonEntriesOf(root), ...jsonEntriesOf(project) }
  return Object.keys(merged).length === 0 ? {} : { provide: merged }
}
export const extractVitestConfig = (root: VitestRootView): VmVitestConfig => ({
  ...(root.configFile === undefined ? {} : { configFile: root.configFile }),
  browser: root.projects.some((project) => project.browserEnabled),
  projects: root.projects.map((project) =>
    extractProjectConfig(project.config, project.viteEnv, project.serverConditions, root.provide, root.envSeeds)
  ),
})
