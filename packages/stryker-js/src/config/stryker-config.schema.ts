import { Options } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Effect from 'effect/Effect'
import { dual } from 'effect/Function'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Predicate from 'effect/Predicate'
import * as Record from 'effect/Record'
import * as S from 'effect/Schema'

type DocumentRecord<A = unknown> = { readonly [key: string]: A }

interface MergedConfigRecord<A = unknown> extends Record<string, A | MergedConfigRecord<A>> {}

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

const hasUsableMember = (key: string) => <A>(merged: MergedConfigRecord<A>): boolean =>
  merged.hasOwnProperty(key) && merged[key] !== undefined

const ownValueOf = <A = unknown>(
  merged: MergedConfigRecord<A>,
  key: string,
): Option.Option<A | MergedConfigRecord<A> | undefined> =>
  Option.map(Option.liftPredicate(merged, hasUsableMember(key)), (present) => present[key])

const baseRecordOf = <A = unknown>(
  ownValue: Option.Option<A | MergedConfigRecord<A> | undefined>,
): Option.Option<MergedConfigRecord<A>> =>
  Option.filter(Option.flatMap(ownValue, Option.fromUndefinedOr), isConfigRecord)

const mergeKeyInto = <A = unknown>(
  merged: MergedConfigRecord<A>,
  override: A | MergedConfigRecord<A>,
  key: string,
): MergedConfigRecord<A> => ({
  ...merged,
  [key]: Option.match(baseRecordOf(ownValueOf(merged, key)), {
    onNone: () => override,
    onSome: (baseRecord) => mergeNested(baseRecord, override),
  }),
})

const mergeRecords = <A = unknown>(
  base: MergedConfigRecord<A>,
  overrides: MergedConfigRecord<A>,
): MergedConfigRecord<A> => Record.reduce(usableEntries(overrides), usableEntries(base), mergeKeyInto)

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

export type StrykerConfigFn = (env: ConfigEnv) => Options.PartialStrykerOptions | Promise<Options.PartialStrykerOptions>

export type StrykerConfigExport =
  | Options.PartialStrykerOptions
  | Promise<Options.PartialStrykerOptions>
  | StrykerConfigFn

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
  static define(config: Options.PartialStrykerOptions): Options.PartialStrykerOptions
  static define(config: Promise<Options.PartialStrykerOptions>): Promise<Options.PartialStrykerOptions>
  static define(config: StrykerConfigFn): StrykerConfigFn
  static define(config: StrykerConfigExport): StrykerConfigExport
  static define(config: StrykerConfigExport): StrykerConfigExport {
    return config
  }

  static readonly merge: {
    (
      overrides: Options.PartialStrykerOptions,
    ): (defaults: Options.PartialStrykerOptions) => Options.PartialStrykerOptions
    (defaults: Options.PartialStrykerOptions, overrides: Options.PartialStrykerOptions): Options.PartialStrykerOptions
  } = dual(
    2,
    (
      defaults: Options.PartialStrykerOptions,
      overrides: Options.PartialStrykerOptions,
    ): Options.PartialStrykerOptions => mergeRecords(defaults, overrides),
  )

  static readonly createDefaultOptions: Effect.Effect<Options.StrykerOptions> = S.decodeEffect(
    Options.StrykerOptionsSchema,
  )({}).pipe(
    Effect.orDie,
  )

  static readonly defaultOptions: Effect.Effect<Immutable<Options.StrykerOptions>, never, never> = Effect.map(
    StrykerConfig.createDefaultOptions,
    (options) => deepFreeze(options),
  )

  static readonly supportedFileNames: readonly string[] = CONFIG_FILE_NAMES

  static readonly syntaxHelp: string = CONFIG_SYNTAX_HELP
}

if (import.meta.vitest !== void 0) {
  const { describe, it } = await import('@effect/vitest')
  const Arr = await import('effect/Array')
  const Equal = await import('effect/Equal')
  const { Arbitrary } = await import('effect/unstable/arbitrary')
  const { DocumentSchema, NestedDocumentSchema } = await import('../../tests/__fixtures__/config-law.schema.js')

  const poisonedDocumentArb = Arbitrary.schema(DocumentSchema).pipe(
    Arbitrary.map((document) => ({
      ...document,
      ...Object.fromEntries([['__proto__', Object.fromEntries([['polluted', true]])]]),
    })),
  )

  const isDocumentRecord = (value: unknown): value is DocumentRecord =>
    Predicate.isObject(value) && Arr.isArray(value) === false

  const statedKeys = (document: DocumentRecord): ReadonlyArray<string> =>
    Object.keys(document).filter((key) => key !== '__proto__' && document[key] !== undefined)

  const usableEntriesOnly = <A = unknown>(document: DocumentRecord<A>): DocumentRecord<A> =>
    Object.fromEntries(Object.entries(document).filter(([key, value]) => key !== '__proto__' && value !== undefined))

  const overlaid = <A = unknown>(base: DocumentRecord<A>, overrides: DocumentRecord<A>): DocumentRecord<A> => ({
    ...usableEntriesOnly(base),
    ...usableEntriesOnly(overrides),
  })

  const expectedNestedOf = <A = unknown>(baseValue: A | undefined, override: A): A | DocumentRecord =>
    Option.match(
      Option.all([Option.liftPredicate(baseValue, isDocumentRecord), Option.liftPredicate(override, isDocumentRecord)]),
      {
        onNone: () => override,
        onSome: ([baseRecord, overrideRecord]) => overlaid(baseRecord, overrideRecord),
      },
    )

  describe('mergeRecords', () => {
    it.prop(
      '∀d_Merge_empty_≡KeepsEveryEntryInOrder',
      [DocumentSchema],
      ([document]) => Equal.equals(mergeRecords(document, {}), usableEntriesOnly(document)),
    )

    it.prop(
      '∀do_Merge_≡StatedKeyWins',
      [DocumentSchema, DocumentSchema],
      ([base, overrides]) => Equal.equals(mergeRecords(base, overrides), overlaid(base, overrides)),
    )

    it.prop(
      '∀do_Merge_≡BaseKeysFirstThenNewOverrideKeys',
      [DocumentSchema, DocumentSchema],
      ([base, overrides]) =>
        Equal.equals(Object.keys(mergeRecords(base, overrides)), Object.keys(overlaid(base, overrides))),
    )

    it.prop('∀do_Merge_≡Idempotent', [DocumentSchema, DocumentSchema], ([base, overrides]) =>
      Equal.equals(
        mergeRecords(mergeRecords(base, overrides), overrides),
        mergeRecords(base, overrides),
      ))

    it.prop(
      '∀do_Merge_≡NestedRecordsMergeRecursively',
      [NestedDocumentSchema, NestedDocumentSchema],
      ([base, overrides]) => {
        const kept = usableEntriesOnly(base)
        const merged = mergeRecords(base, overrides)
        return statedKeys(overrides).every((key) =>
          Equal.equals(merged[key], expectedNestedOf(kept[key], overrides[key]))
        ) &&
          statedKeys(kept).every((key) => key in merged)
      },
    )

    it.prop(
      '∀do_Merge_∈DocumentKeysNeverReachThePrototype',
      [poisonedDocumentArb, poisonedDocumentArb],
      ([base, overrides]) => {
        const merged = mergeRecords(base, overrides)
        return Equal.equals(
          [
            Object.getOwnPropertyNames(merged).includes('__proto__'),
            Object.getPrototypeOf(merged) === Object.prototype,
            Object.getOwnPropertyNames(Object.prototype).includes('polluted'),
          ],
          [false, true, false],
        )
      },
    )
  })
}
