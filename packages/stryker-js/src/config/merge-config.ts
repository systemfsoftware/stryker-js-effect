/// <reference types="vitest/importMeta" />
import { Options } from '@systemfsoftware/stryker-js-plugin-interface'
import { dual } from 'effect/Function'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Predicate from 'effect/Predicate'
import * as Record from 'effect/Record'

import type { StrykerConfig } from './stryker-config.schema.js'

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

export const mergeConfig: {
  (
    overrides: StrykerConfig,
  ): (defaults: StrykerConfig) => StrykerConfig
  (defaults: StrykerConfig, overrides: StrykerConfig): StrykerConfig
} = dual(
  2,
  (defaults: StrykerConfig, overrides: StrykerConfig): StrykerConfig => mergeRecords(defaults, overrides),
)

const isNonNullObject = (value: unknown): value is object => typeof value === 'object' && value !== null

const asUnknownArray = <A = unknown>(value: A): readonly A[] => Array.isArray(value) ? value : []

const isFirstDescriptorOccurrence =
  <A = unknown>(descriptors: readonly A[]) => (descriptor: A, index: number): boolean =>
    typeof descriptor !== 'string' || descriptors.slice(0, index).includes(descriptor) === false

const mergePluginDescriptors = <A = unknown>(
  parentPlugins: readonly A[],
  childPlugins: readonly A[],
): readonly A[] => {
  const merged = [...parentPlugins, ...childPlugins]
  return merged.filter(isFirstDescriptorOccurrence(merged))
}

const isConfigOptionsRecord = <A = unknown>(value: unknown): value is Record<string, A> =>
  isNonNullObject(value) && Array.isArray(value) === false

const mergeConfigRecords = <A = unknown>(
  parentNested: Record<string, A>,
  childNested: Record<string, A>,
): Record<string, A> => ({ ...parentNested, ...childNested })

const toConfigRecordOption = <A = unknown>(value: A): Option.Option<Record<string, A>> =>
  isConfigOptionsRecord<A>(value) ? Option.some(value) : Option.none()

const inheritNested = <A = unknown>(parentValue: A, childValue: A): A | Record<string, A> =>
  Option.match(Option.all([toConfigRecordOption(parentValue), toConfigRecordOption(childValue)]), {
    onSome: ([parentNested, childNested]) => mergeConfigRecords(parentNested, childNested),
    onNone: () => childValue,
  })

type ConfigOptionValue = Options.PartialStrykerOptions extends Record<string, infer OptionValue> ? OptionValue : never

const inheritEntry = (
  out: Options.PartialStrykerOptions,
  key: string,
  parentValue: ConfigOptionValue,
  childValue: ConfigOptionValue,
): Options.PartialStrykerOptions =>
  Match.value(childValue).pipe(
    Match.when(null, () => {
      const next = { ...out }
      delete next[key]
      return next
    }),
    Match.orElse(() =>
      Match.value(key).pipe(
        Match.when(
          'plugins',
          () => ({
            ...out,
            [key]: mergePluginDescriptors(asUnknownArray(parentValue), asUnknownArray(childValue)),
          }),
        ),
        Match.orElse(() => ({ ...out, [key]: inheritNested(parentValue, childValue) })),
      )
    ),
  )

export const mergeConfigs = dual<
  (child: Options.PartialStrykerOptions) => (parent: Options.PartialStrykerOptions) => Options.PartialStrykerOptions,
  (parent: Options.PartialStrykerOptions, child: Options.PartialStrykerOptions) => Options.PartialStrykerOptions
>(2, (parent, child) =>
  Object.entries(child).reduce(
    (out, entry) => inheritEntry(out, entry[0], parent[entry[0]], entry[1]),
    { ...parent },
  ))

if (import.meta.vitest !== void 0) {
  const { it } = await import('@systemfsoftware/vitest')
  const Arr = await import('effect/Array')
  const Equal = await import('effect/Equal')
  const S = await import('effect/Schema')
  const { Arbitrary } = await import('effect/unstable/arbitrary')
  type DocumentRecord<A = unknown> = { readonly [key: string]: A }
  const OptionValueSchema = S.Union([S.String, S.Finite, S.Boolean, S.Null, S.Undefined])
  const DocumentSchema = S.Record(S.String, OptionValueSchema)
  const NestedDocumentSchema = S.Record(S.String, S.Union([OptionValueSchema, S.Record(S.String, OptionValueSchema)]))

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

  it.prop(
    '∀d_Merge_≡KeepsEveryEntryInOrder',
    { of: [DocumentSchema], subject: mergeRecords },
    (subject, [document]) => Equal.equals(subject(document, {}), usableEntriesOnly(document)),
  )

  it.prop(
    '∀do_Merge_≡StatedKeyWins',
    { of: [DocumentSchema, DocumentSchema], subject: mergeRecords },
    (subject, [base, overrides]) => Equal.equals(subject(base, overrides), overlaid(base, overrides)),
  )

  it.prop(
    '∀do_Merge_≡BaseKeysFirstThenNewOverrideKeys',
    { of: [DocumentSchema, DocumentSchema], subject: mergeRecords },
    (subject, [base, overrides]) =>
      Equal.equals(Object.keys(subject(base, overrides)), Object.keys(overlaid(base, overrides))),
  )

  it.prop(
    '∀do_Merge_≡Idempotent',
    { of: [DocumentSchema, DocumentSchema], subject: mergeRecords },
    (subject, [base, overrides]) =>
      Equal.equals(
        subject(subject(base, overrides), overrides),
        subject(base, overrides),
      ),
  )

  it.prop(
    '∀do_Merge_≡NestedRecordsMergeRecursively',
    { of: [NestedDocumentSchema, NestedDocumentSchema], subject: mergeRecords },
    (subject, [base, overrides]) => {
      const kept = usableEntriesOnly(base)
      const merged = subject(base, overrides)
      const nestedOf = expectedNestedOf
      return statedKeys(overrides).every((key) => Equal.equals(merged[key], nestedOf(kept[key], overrides[key]))) &&
        statedKeys(kept).every((key) => key in merged)
    },
  )

  it.prop(
    '∀do_Merge_∈DocumentKeysNeverReachThePrototype',
    { of: [poisonedDocumentArb, poisonedDocumentArb], subject: mergeRecords },
    (subject, [base, overrides]) => {
      const merged = subject(base, overrides)
      return Equal.equals(
        [
          Object.hasOwn(merged, '__proto__'),
          Object.getPrototypeOf(merged) === Object.prototype,
          Object.hasOwn(Object.prototype, 'polluted'),
        ],
        [false, true, false],
      )
    },
  )
}
