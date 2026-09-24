import type { PartialStrykerOptions, StrykerOptions } from '@systemfsoftware/stryker-js-plugin-interface'
import { StrykerOptionsSchema } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Effect from 'effect/Effect'
import { dual } from 'effect/Function'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Predicate from 'effect/Predicate'
import * as Record from 'effect/Record'
import * as S from 'effect/Schema'

export type Primitive = boolean | number | string | null | undefined

export type ImmutablePrimitive = Primitive | ((...args: never[]) => void)

export type Immutable<T> = T extends ImmutablePrimitive ? T
  : T extends Array<infer U> ? ReadonlyArray<Immutable<U>>
  : T extends Map<infer K, infer V> ? ReadonlyMap<Immutable<K>, Immutable<V>>
  : T extends Set<infer M> ? ReadonlySet<Immutable<M>>
  : T extends RegExp ? Readonly<RegExp>
  : { readonly [K in keyof T]: Immutable<T[K]> }

export const ConfigEnvSchema = S.Struct({
  command: S.Literals(['run', 'merge-reports']),
  isDryRun: S.Boolean,
  mode: S.Literals(['human', 'machine']),
  isCi: S.Boolean,
})
export type ConfigEnv = typeof ConfigEnvSchema.Type

export type StrykerConfigFn = (env: ConfigEnv) => PartialStrykerOptions | Promise<PartialStrykerOptions>

export type StrykerConfigExport = PartialStrykerOptions | Promise<PartialStrykerOptions> | StrykerConfigFn

interface MergedConfigRecord<A = unknown> extends Record<string, A | MergedConfigRecord<A>> {}

const isNonNullObject = (value: unknown): value is object => typeof value === 'object' && value !== null

const isRecordValue = <A = unknown>(value: unknown): value is Record<string, A> =>
  isNonNullObject(value) && Array.isArray(value) === false

const isArrayValue = <A = unknown>(value: unknown): value is readonly A[] => Array.isArray(value)

const freezeArrayValue = <A = unknown>(value: readonly A[]): ReadonlyArray<Immutable<A>> =>
  Object.freeze(value.map((element) => deepFreeze(element)))

const freezeMapEntry = <K = unknown, V = unknown>(
  [entryKey, entryValue]: readonly [K, V],
): readonly [Immutable<K>, Immutable<V>] => [deepFreeze(entryKey), deepFreeze(entryValue)]

const freezeMapValue = <K = unknown, V = unknown>(value: Map<K, V>): ReadonlyMap<Immutable<K>, Immutable<V>> =>
  Object.freeze(new Map([...value.entries()].map(freezeMapEntry)))

const freezeSetValue = <A = unknown>(value: Set<A>): ReadonlySet<Immutable<A>> =>
  Object.freeze(new Set([...value.values()].map((element) => deepFreeze(element))))

const freezeRegExpValue = (value: RegExp): RegExp => Object.freeze(value)

const freezeRecordValue = <A = unknown>(value: Record<string, A>): Record<string, Immutable<A>> =>
  Object.freeze(Record.map(value, (propertyValue) => deepFreeze(propertyValue)))

function deepFreeze<T>(target: T): Immutable<T>
function deepFreeze(target: object | Primitive): object | Primitive {
  return Match.value(target).pipe(
    Match.when(isArrayValue, freezeArrayValue),
    Match.when(
      <K = unknown, V = unknown>(value: unknown): value is Map<K, V> => value instanceof Map,
      freezeMapValue,
    ),
    Match.when((value: unknown): value is RegExp => value instanceof RegExp, freezeRegExpValue),
    Match.when(
      <A2 = unknown>(value: unknown): value is Set<A2> => value instanceof Set,
      freezeSetValue,
    ),
    Match.when(isRecordValue, freezeRecordValue),
    Match.orElse(() => target),
  )
}

/**
 * Whether an entry takes part in a merge: a key literally named `__proto__` never does — the
 * merged record must not gain a document-decided prototype — and an explicitly `undefined`
 * value states that the author left the key unset, not that they want it set to nothing.
 */
const usable = <A = unknown>(value: A, key: string): boolean => key !== '__proto__' && value !== undefined

const usableEntries = <A = unknown>(source: MergedConfigRecord<A>): MergedConfigRecord<A> =>
  Record.filter(source, usable)

const isConfigRecord = <A = unknown>(
  value: A | MergedConfigRecord<A> | undefined,
): value is MergedConfigRecord<A> => Predicate.isObject(value)

const asConfigRecord = <A = unknown>(
  value: A | MergedConfigRecord<A> | undefined,
): Option.Option<MergedConfigRecord<A>> => Option.filter(Option.fromUndefinedOr(value), isConfigRecord)

const mergeNested = <A = unknown>(
  base: MergedConfigRecord<A>,
  override: A | MergedConfigRecord<A>,
): A | MergedConfigRecord<A> =>
  Option.match(asConfigRecord(override), {
    onNone: () => override,
    onSome: (overrideRecord) => mergeRecords(base, overrideRecord),
  })

const baseRecordOf = <A = unknown>(
  base: MergedConfigRecord<A>,
): Option.Option<MergedConfigRecord<A>> => Option.filter(Option.fromUndefinedOr(base), isConfigRecord)

const mergeKeyInto = <A = unknown>(
  merged: MergedConfigRecord<A>,
  key: string,
  override: A | MergedConfigRecord<A>,
): MergedConfigRecord<A> => ({
  ...merged,
  [key]: Option.match(baseRecordOf(merged[key]), {
    onNone: () => override,
    onSome: (baseRecord) => mergeNested(baseRecord, override),
  }),
})

const mergeRecords = <A = unknown>(
  base: MergedConfigRecord<A>,
  overrides: MergedConfigRecord<A>,
): MergedConfigRecord<A> =>
  Record.reduce(usableEntries(overrides), usableEntries(base), mergeKeyInto)

const configFileNames = (extensions: readonly string[]): readonly string[] =>
  extensions.map((extension) => `stryker.config${extension}`)

const CONFIG_FILE_EXTENSIONS: readonly string[] = ['.ts', '.mts', '.js', '.mjs']

const CONFIG_FILE_NAMES = Object.freeze(configFileNames(CONFIG_FILE_EXTENSIONS))

const CONFIG_SYNTAX_HELP = `
Example of how a config file should look:
/**
  * @type {import('@systemfsoftware/stryker-js-plugin-interface').StrykerOptions}
  */
export default {
  mutate: ['src/**/*.js'],
  testRunner: 'vitest',
  reporters: ['progress', 'clear-text', 'html'],
  concurrency: 4
};
See https://stryker-mutator.io/docs/stryker-js/config-file for more information.`.trim()

export class StrykerConfig extends S.Class<StrykerConfig>('StrykerConfig')({
  entries: S.Record(S.String, S.Unknown),
}) {
  static readonly define: {
    (config: PartialStrykerOptions): PartialStrykerOptions
    (config: Promise<PartialStrykerOptions>): Promise<PartialStrykerOptions>
    (config: StrykerConfigFn): StrykerConfigFn
    (config: StrykerConfigExport): StrykerConfigExport
  } = (config) => config

  static readonly merge: {
    (overrides: PartialStrykerOptions): (defaults: PartialStrykerOptions) => PartialStrykerOptions
    (defaults: PartialStrykerOptions, overrides: PartialStrykerOptions): PartialStrykerOptions
  } = dual(2, (defaults: PartialStrykerOptions, overrides: PartialStrykerOptions) => mergeRecords(defaults, overrides))

  static readonly createDefaultOptions: Effect.Effect<StrykerOptions> = S.decodeEffect(StrykerOptionsSchema)({}).pipe(
    Effect.orDie,
  )

  static readonly defaultOptions: Effect.Effect<Immutable<StrykerOptions>, never, never> = Effect.map(
    StrykerConfig.createDefaultOptions,
    (options) => deepFreeze(options),
  )

  static readonly supportedFileNames: readonly string[] = CONFIG_FILE_NAMES

  static readonly syntaxHelp: string = CONFIG_SYNTAX_HELP
}