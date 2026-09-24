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

/** The recursive generic needs its declaration to name `Immutable<T>`; an inferred return cannot. */
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
 * Whether an entry takes part in a merge: `__proto__` never does — a document must not be
 * able to reach the merged record's prototype, which is what a config-file key literally
 * named `__proto__` would otherwise do — and an explicitly `undefined` value states that the
 * author left the key unset rather than that they want it set to nothing.
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

/**
 * The value the merged record takes at `key`: the override when the override states one,
 * a recursive merge when both sides hold a record, and the base's own value otherwise.
 */
const mergeKey = <A = unknown>(
  base: MergedConfigRecord<A>,
  additions: MergedConfigRecord<A>,
  key: string,
): A | MergedConfigRecord<A> =>
  Option.match(Option.fromUndefinedOr(additions[key]), {
    onNone: () => base[key],
    onSome: (override) =>
      Option.match(asConfigRecord(base[key]), {
        onNone: () => override,
        onSome: (baseRecord) => mergeNested(baseRecord, override),
      }),
  })

/**
 * Merges two config documents key by key: a key the base states and the override does not
 * keeps the base's position and value, a key both state merges recursively when both values
 * are records and otherwise takes the override's value, and a key only the override states
 * is appended in the override's order.
 */
const mergeRecords = <A = unknown>(
  base: MergedConfigRecord<A>,
  overrides: MergedConfigRecord<A>,
): MergedConfigRecord<A> => {
  const additions = usableEntries(overrides)
  return Record.map({ ...usableEntries(base), ...additions }, (_value, key) => mergeKey(base, additions, key))
}

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

/**
 * A Stryker configuration document, and the operations a config author writes against it.
 *
 * The class is the schema that owns the config file's meaning: `entries` is the open record
 * of configured option entries a config file exports, and the statics are what that meaning
 * owns — the config file names this document is read from, the syntax help a failing config
 * read prints, the default option set, and the two authoring operations `define` and `merge`.
 */
export class StrykerConfig extends S.Class<StrykerConfig>('StrykerConfig')({
  entries: S.Record(S.String, S.Unknown),
}) {
  /** Identity: a config author reaches autocompletion and checking without a runtime dependency. */
  static readonly define: {
    (config: PartialStrykerOptions): PartialStrykerOptions
    (config: Promise<PartialStrykerOptions>): Promise<PartialStrykerOptions>
    (config: StrykerConfigFn): StrykerConfigFn
    (config: StrykerConfigExport): StrykerConfigExport
  } = (config) => config

  /** `merge(overrides)(defaults)` or `merge(defaults, overrides)`: the preset composer. */
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