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

type AnyDecoded<A = unknown> = A

const propertyOf = <A = unknown>(row: A, key: string): AnyDecoded =>
  Predicate.isObject(row) ? ownValueOf(row, key) : undefined

const ownValueOf = (row: object, key: string): AnyDecoded => {
  const value: AnyDecoded = Object.getOwnPropertyDescriptor(row, key)?.value
  return value
}

const decodedJsonOf = <A = unknown>(value: A, key: string): Json | undefined =>
  Option.getOrElse(S.decodeUnknownOption(S.Json)(propertyOf(value, key)), () => undefined)

const entryOf = <A>(value: A | undefined, key: string): ReadonlyArray<readonly [string, A]> =>
  value === undefined ? [] : [[key, value]]

const jsonPairOf = <A = unknown>(value: A, key: string): ReadonlyArray<readonly [string, Json]> =>
  entryOf(decodedJsonOf(value, key), key)

const jsonEntriesFromObject = (value: object): Record<string, Json> =>
  Object.fromEntries(Object.keys(value).flatMap((key) => jsonPairOf(value, key)))

const jsonEntriesOf = <A = unknown>(value: A): Record<string, Json> =>
  Predicate.isObject(value) ? jsonEntriesFromObject(value) : {}

const stringEntryOf = (entry: readonly [string, Json]): ReadonlyArray<readonly [string, string]> =>
  typeof entry[1] === 'string' ? [[entry[0], entry[1]]] : []

const stringEntriesOf = <A = unknown>(value: A): Record<string, string> =>
  Object.fromEntries(Object.entries(jsonEntriesOf(value)).flatMap(stringEntryOf))

const listOf = <A>(value: ReadonlyArray<A> | undefined): ReadonlyArray<A> => value ?? []

const aliasFindOf = (find: VitestAliasView['find']): VmProjectConfig['alias'][number]['find'] =>
  typeof find === 'string' ? find : { source: find.source, flags: find.flags }

const isAliasRecord = (value: AliasConfigView): value is Readonly<Record<string, string>> => !Array.isArray(value)

const aliasEntryOf = (find: string, replacement: string | undefined): ReadonlyArray<VitestAliasView> =>
  replacement === undefined ? [] : [{ find, replacement }]

const aliasEntriesOf = (value: Readonly<Record<string, string>>): ReadonlyArray<VitestAliasView> =>
  Object.keys(value).flatMap((find) => aliasEntryOf(find, value[find]))

const arrayAliasEntryOf = (entry: VitestAliasView): VitestAliasView => ({
  find: aliasFindOf(entry.find),
  replacement: entry.replacement,
})

const aliasesFrom = (value: AliasConfigView): ReadonlyArray<VitestAliasView> =>
  isAliasRecord(value) ? aliasEntriesOf(value) : value.map(arrayAliasEntryOf)

const aliasListOf = (value: AliasConfigView | undefined): ReadonlyArray<VitestAliasView> =>
  value === undefined ? [] : aliasesFrom(value)

const vmAliasEntryOf = (entry: VitestAliasView): VmProjectConfig['alias'][number] => ({
  find: aliasFindOf(entry.find),
  replacement: entry.replacement,
})

const isOrderValue = (value: string | undefined): value is 'list' | 'parallel' =>
  value === 'list' || value === 'parallel'

const hooksOf = (value: string | undefined): 'stack' | 'list' | 'parallel' => isOrderValue(value) ? value : 'stack'

const setupFilesOrderOf = (value: string | undefined): 'list' | 'parallel' => (value === 'list' ? 'list' : 'parallel')

const namePatternOf = (pattern: RegExp | string): NonNullable<VmProjectConfig['testNamePattern']> =>
  typeof pattern === 'string' ? { source: pattern, flags: '' } : { source: pattern.source, flags: pattern.flags }

const stringValueOrEmpty = <A = unknown>(value: A): string => (typeof value === 'string' ? value : '')

const TAG_META_KEYS: Record<string, true> = { name: true, description: true }

const isTagMetaKey = (key: string): boolean => TAG_META_KEYS[key] === true

const tagOptionPairOf = (definition: ArbitraryRecord, key: string): ReadonlyArray<readonly [string, Json]> => {
  if (isTagMetaKey(key)) return []
  return entryOf(decodedJsonOf(definition, key), key)
}

const tagOptionsOf = (definition: ArbitraryRecord): Record<string, Json> =>
  Object.fromEntries(Object.keys(definition).flatMap((key) => tagOptionPairOf(definition, key)))

const tagNameOf = (definition: ArbitraryRecord): string => stringValueOrEmpty(propertyOf(definition, 'name'))

const descriptionSpreadOf = (definition: ArbitraryRecord): { readonly description?: string } => {
  const description = propertyOf(definition, 'description')
  if (typeof description !== 'string') return {}
  return { description }
}

const tagOf = (definition: ArbitraryRecord): VmTagDefinition => ({
  name: tagNameOf(definition),
  ...descriptionSpreadOf(definition),
  options: tagOptionsOf(definition),
})

const withDefault = <A>(value: A | undefined, fallback: A): A => value ?? fallback

const numberOrZero = (value: number | undefined): number => value ?? 0

const retryOf = (retry: number | object | undefined): number => (typeof retry === 'number' ? retry : 0)

const sequenceOf = (view: VitestProjectConfigView): VitestProjectConfigView['sequence'] => view.sequence

const concurrentOf = (view: VitestProjectConfigView): boolean => withDefault(sequenceOf(view)?.concurrent, false)

const shuffleOf = (view: VitestProjectConfigView): boolean => withDefault(sequenceOf(view)?.shuffle, false)

const sequenceHooksOf = (view: VitestProjectConfigView): 'stack' | 'list' | 'parallel' =>
  hooksOf(sequenceOf(view)?.hooks)

const sequenceSetupFilesOf = (view: VitestProjectConfigView): 'list' | 'parallel' =>
  setupFilesOrderOf(sequenceOf(view)?.setupFiles)

const seedOf = (view: VitestProjectConfigView): number | undefined => sequenceOf(view)?.seed

const seedSpreadOf = (view: VitestProjectConfigView): { readonly seed?: number } =>
  Option.match(Option.fromNullishOr(seedOf(view)), {
    onNone: () => ({}),
    onSome: (seed) => ({ seed }),
  })

const expectOf = (view: VitestProjectConfigView): VitestProjectConfigView['expect'] => view.expect

const requireAssertionsOf = (view: VitestProjectConfigView, base: VmProjectConfig): boolean =>
  withDefault(expectOf(view)?.requireAssertions, base.expect.requireAssertions)

type VitestPollView = NonNullable<VitestProjectConfigView['expect']>['poll']

const pollOf = (view: VitestProjectConfigView): VitestPollView => expectOf(view)?.poll

const pollTimeoutOf = (view: VitestProjectConfigView, base: VmProjectConfig): number =>
  withDefault(pollOf(view)?.timeout, base.expect.poll.timeout)

const pollIntervalOf = (view: VitestProjectConfigView, base: VmProjectConfig): number =>
  withDefault(pollOf(view)?.interval, base.expect.poll.interval)

const expectConfigOf = (view: VitestProjectConfigView, base: VmProjectConfig): VmProjectConfig['expect'] => ({
  requireAssertions: requireAssertionsOf(view, base),
  poll: {
    timeout: pollTimeoutOf(view, base),
    interval: pollIntervalOf(view, base),
  },
})

const defineEntriesOf = (view: VitestProjectConfigView): Record<string, Json> => ({
  ...jsonEntriesOf(view.define),
  ...jsonEntriesOf(view.defines),
})

const envEntriesOf = (
  view: VitestProjectConfigView,
  viteEnv: ArbitraryRecord | undefined,
  hostEnvSeeds: ArbitraryRecord | undefined,
): Record<string, string> => ({
  ...stringEntriesOf(viteEnv),
  ...stringEntriesOf(view.env),
  ...stringEntriesOf(hostEnvSeeds),
})

const namePatternSpreadOf = (
  view: VitestProjectConfigView,
): { readonly testNamePattern: NonNullable<VmProjectConfig['testNamePattern']> } | Record<never, never> => {
  const pattern = view.testNamePattern
  if (pattern === undefined) return {}
  return { testNamePattern: namePatternOf(pattern) }
}

const allowOnlySpreadOf = (view: VitestProjectConfigView): { readonly allowOnly: boolean } | Record<never, never> =>
  view.allowOnly === undefined ? {} : { allowOnly: view.allowOnly }

const provideSpreadOf = (
  project: ArbitraryRecord | undefined,
  root: ArbitraryRecord | undefined,
): { readonly provide?: Record<string, Json> } => {
  const merged = { ...jsonEntriesOf(root), ...jsonEntriesOf(project) }
  return Object.keys(merged).length === 0 ? {} : { provide: merged }
}

const extractProjectConfig = (
  view: VitestProjectConfigView,
  viteEnv: ArbitraryRecord | undefined,
  serverConditions: ReadonlyArray<string> | undefined,
  rootProvide?: ArbitraryRecord,
  hostEnvSeeds?: ArbitraryRecord,
): VmProjectConfig => {
  const base = defaultProjectConfig(view.root)
  return {
    name: withDefault(view.name, base.name),
    root: view.root,
    include: listOf(view.include),
    exclude: listOf(view.exclude),
    includeSource: listOf(view.includeSource),
    setupFiles: listOf(view.setupFiles),
    globals: withDefault(view.globals, base.globals),
    environment: withDefault(view.environment, base.environment),
    environmentOptions: jsonEntriesOf(view.environmentOptions),
    isolate: withDefault(view.isolate, base.isolate),
    testTimeout: withDefault(view.testTimeout, base.testTimeout),
    hookTimeout: withDefault(view.hookTimeout, base.hookTimeout),
    retry: retryOf(view.retry),
    repeats: numberOrZero(view.repeats),
    maxConcurrency: withDefault(view.maxConcurrency, base.maxConcurrency),
    restoreMocks: withDefault(view.restoreMocks, base.restoreMocks),
    clearMocks: withDefault(view.clearMocks, base.clearMocks),
    mockReset: withDefault(view.mockReset, base.mockReset),
    unstubGlobals: withDefault(view.unstubGlobals, base.unstubGlobals),
    unstubEnvs: withDefault(view.unstubEnvs, base.unstubEnvs),
    snapshotFormat: jsonEntriesOf(view.snapshotFormat),
    snapshotSerializers: listOf(view.snapshotSerializers),
    fakeTimers: jsonEntriesOf(view.fakeTimers),
    expect: expectConfigOf(view, base),
    define: defineEntriesOf(view),
    env: envEntriesOf(view, viteEnv, hostEnvSeeds),
    alias: aliasListOf(view.alias).map(vmAliasEntryOf),
    conditions: listOf(serverConditions),
    ...namePatternSpreadOf(view),
    globalSetup: listOf(view.globalSetup),
    injectCjsGlobals: withDefault(view.injectCjsGlobals, true),
    tags: listOf(view.tags).map(tagOf),
    strictTags: withDefault(view.strictTags, true),
    ...allowOnlySpreadOf(view),
    sequence: {
      concurrent: concurrentOf(view),
      shuffle: shuffleOf(view),
      ...seedSpreadOf(view),
      hooks: sequenceHooksOf(view),
      setupFiles: sequenceSetupFilesOf(view),
    },
    ...provideSpreadOf(view.provide, rootProvide),
  }
}

export const extractVitestConfig = (root: VitestRootView): VmVitestConfig => ({
  ...(root.configFile === undefined ? {} : { configFile: root.configFile }),
  browser: root.projects.some((project) => project.browserEnabled),
  projects: root.projects.map((project) =>
    extractProjectConfig(project.config, project.viteEnv, project.serverConditions, root.provide, root.envSeeds)
  ),
})
