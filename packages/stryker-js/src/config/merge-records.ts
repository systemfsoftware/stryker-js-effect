import { dual } from 'effect/Function'
import * as Option from 'effect/Option'
import * as Predicate from 'effect/Predicate'
import * as Record from 'effect/Record'

export type DocumentRecord<A = unknown> = { readonly [key: string]: A }

export interface MergedConfigRecord<A = unknown> extends Record<string, A | MergedConfigRecord<A>> {}

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
    onSome: (overrideRecord) => mergeRecordsOf(base, overrideRecord),
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

const mergeRecordsOf = <A = unknown>(
  base: MergedConfigRecord<A>,
  overrides: MergedConfigRecord<A>,
): MergedConfigRecord<A> => Record.reduce(usableEntries(overrides), usableEntries(base), mergeKeyInto)
export const mergeRecords: {
  <A>(overrides: MergedConfigRecord<A>): (base: MergedConfigRecord<A>) => MergedConfigRecord<A>
  <A>(base: MergedConfigRecord<A>, overrides: MergedConfigRecord<A>): MergedConfigRecord<A>
} = dual(2, mergeRecordsOf)
