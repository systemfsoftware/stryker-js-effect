import type { Mutant } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Arr from 'effect/Array'
import * as Context from 'effect/Context'
import * as Effect from 'effect/Effect'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as S from 'effect/Schema'

import { entryNameOf } from './verdict-blobs.js'
import {
  type CheckerEntry,
  CheckerEntrySchema,
  TestedEntrySchema,
  type VerdictComponents,
  type VerdictEntry,
  VerdictEntryJson,
  VerdictEntrySchema,
  type VerdictKey,
} from './VerdictEntry.schema.js'
import { verdictKeyOf } from './VerdictKey.js'
import {
  EntriesListed,
  EntryAbsent,
  EntryFound,
  EntryUnreadable,
  EntryWritten,
  type GetOutcome,
  type ListedEntry,
  type ListOutcome,
  type PutOutcome,
} from './VerdictStore.schema.js'
import { VerdictStore } from './VerdictStore.service.js'

export interface VerdictStoreHarnessShape {
  readonly corrupt: (name: string) => Effect.Effect<void>
  readonly reset: Effect.Effect<void>
}

export class VerdictStoreHarness extends Context.Service<VerdictStoreHarness, VerdictStoreHarnessShape>()(
  '@systemfsoftware/stryker-js/verdict-store/laws/VerdictStoreHarness',
) {}

export type VerdictStoreOps = {
  readonly get: (components: VerdictComponents) => Effect.Effect<GetOutcome, never, VerdictStore>
  readonly put: (entry: VerdictEntry) => Effect.Effect<PutOutcome, never, VerdictStore>
  readonly list: (mutantId: Mutant.MutantId) => Effect.Effect<ListOutcome, never, VerdictStore>
}

type Drawn<G extends ReadonlyArray<S.Top>> = { readonly [K in keyof G]: G[K]['Type'] }

export type VerdictStoreLawRegistrar = <const G extends ReadonlyArray<S.Top>>(
  name: string,
  spec: { readonly of: G; readonly subject: VerdictStoreOps },
  holds: (
    subject: VerdictStoreOps,
    values: Drawn<G>,
  ) => Effect.Effect<boolean, never, VerdictStore | VerdictStoreHarness>,
) => void

const ops: VerdictStoreOps = {
  get: (components) => VerdictStore.use((store) => store.get(components)),
  put: (entry) => VerdictStore.use((store) => store.put(entry)),
  list: (mutantId) => VerdictStore.use((store) => store.list(mutantId)),
}

const encodedOf = S.encodeUnknownOption(VerdictEntryJson)
const isFound = S.is(EntryFound)
const isAbsent = S.is(EntryAbsent)
const isUnreadable = S.is(EntryUnreadable)
const isWritten = S.is(EntryWritten)
const isListed = S.is(EntriesListed)

const allHold = (checks: ReadonlyArray<boolean>): boolean => Arr.every(checks, (check) => check)

const sameEntry = (left: VerdictEntry, right: VerdictEntry): boolean =>
  Option.getOrElse(Option.map(Option.all([encodedOf(left), encodedOf(right)]), ([l, r]) => l === r), () => false)

const foundEntry = (outcome: GetOutcome): Option.Option<VerdictEntry> =>
  Option.map(Option.liftPredicate(outcome, isFound), (found) => found.entry)

const listedOf = (outcome: ListOutcome): ReadonlyArray<ListedEntry> =>
  Option.match(Option.liftPredicate(outcome, isListed), { onNone: () => [], onSome: (listed) => listed.entries })

const finds = (outcome: GetOutcome, expected: VerdictEntry): boolean =>
  Option.match(foundEntry(outcome), { onNone: () => false, onSome: (entry) => sameEntry(entry, expected) })

const writtenUnder = (outcome: PutOutcome, key: VerdictKey): boolean =>
  Option.match(Option.liftPredicate(outcome, isWritten), { onNone: () => false, onSome: (w) => w.key === key })

const unreadableUnder = (outcome: GetOutcome, key: VerdictKey): boolean =>
  Option.match(Option.liftPredicate(outcome, isUnreadable), { onNone: () => false, onSome: (u) => u.key === key })

const isUnreadableListing = (listed: ListedEntry): boolean =>
  Match.valueTags(listed, { Readable: () => false, Unreadable: () => true })

const keysOf = (listed: ReadonlyArray<ListedEntry>): ReadonlyArray<VerdictKey> => listed.map((item) => item.key)

const sameKeySet = (actual: ReadonlyArray<VerdictKey>, expected: ReadonlyArray<VerdictKey>): boolean =>
  allHold([actual.length === expected.length, Arr.every(expected, (key) => actual.includes(key))])

const freshStore = VerdictStoreHarness.use((harness) => harness.reset)

const corrupt = (name: string) => VerdictStoreHarness.use((harness) => harness.corrupt(name))

const putBoth = (store: VerdictStoreOps, first: VerdictEntry, second: VerdictEntry) =>
  Effect.gen(function*() {
    yield* freshStore
    yield* store.put(first)
    yield* store.put(second)
    return [yield* store.get(first.components), yield* store.get(second.components)] as const
  })

const bothFound = (
  [left, right]: readonly [GetOutcome, GetOutcome],
  first: VerdictEntry,
  second: VerdictEntry,
): boolean => allHold([finds(left, first), finds(right, second)])

const sameMutant = (other: CheckerEntry, mutantId: Mutant.MutantId): CheckerEntry => ({
  ...other,
  components: { ...other.components, mutantId },
})

export const registerVerdictStoreLaws = (prop: VerdictStoreLawRegistrar): void => {
  prop(
    '∀e_VerdictStore_≡GetAfterPutReturnsThePutEntryEveryTime',
    { of: [VerdictEntrySchema], subject: ops },
    (store, [entry]) =>
      Effect.gen(function*() {
        yield* freshStore
        const written = yield* store.put(entry)
        const first = yield* store.get(entry.components)
        const second = yield* store.get(entry.components)
        return allHold([
          writtenUnder(written, verdictKeyOf(entry.components)),
          finds(first, entry),
          finds(second, entry),
        ])
      }),
  )

  prop(
    '∀e_VerdictStore_≡AnAbsentKeyIsAMissAndListsNothing',
    { of: [VerdictEntrySchema], subject: ops },
    (store, [entry]) =>
      Effect.gen(function*() {
        yield* freshStore
        const read = yield* store.get(entry.components)
        const listed = yield* store.list(entry.components.mutantId)
        return allHold([isAbsent(read), isListed(listed), listedOf(listed).length === 0])
      }),
  )

  prop(
    '∀ee_VerdictStore_≡PutsOnDifferentKeysCommute',
    { of: [VerdictEntrySchema, VerdictEntrySchema], subject: ops },
    (store, [first, second]) =>
      Effect.gen(function*() {
        const forward = yield* putBoth(store, first, second)
        const backward = yield* putBoth(store, second, first)
        const distinct = verdictKeyOf(first.components) !== verdictKeyOf(second.components)
        return Arr.some([
          !distinct,
          allHold([bothFound(forward, first, second), bothFound(backward, second, first)]),
        ], (holds) => holds)
      }),
  )

  prop(
    '∀tn_VerdictStore_≡ConcurrentPutsToOneKeyLeaveExactlyOneWrittenEntry',
    { of: [TestedEntrySchema, S.Array(TestedEntrySchema.fields.costMs)], subject: ops },
    (store, [base, costs]) =>
      Effect.gen(function*() {
        const written = Arr.map(Arr.append(costs, base.costMs), (costMs): VerdictEntry => ({ ...base, costMs }))
        yield* freshStore
        yield* Effect.forEach(written, (entry) => store.put(entry), { concurrency: 'unbounded', discard: true })
        const read = yield* store.get(base.components)
        const listed = listedOf(yield* store.list(base.components.mutantId))
        const settled = Option.match(foundEntry(read), {
          onNone: () => false,
          onSome: (entry) => Arr.some(written, (candidate) => sameEntry(entry, candidate)),
        })
        return allHold([settled, listed.length === 1])
      }),
  )

  prop(
    '∀e_VerdictStore_≡ACorruptEntryReadsAsAMissAndListsUnreadable',
    { of: [VerdictEntrySchema], subject: ops },
    (store, [entry]) =>
      Effect.gen(function*() {
        yield* freshStore
        yield* store.put(entry)
        yield* corrupt(entryNameOf(entry.components))
        const read = yield* store.get(entry.components)
        const listed = listedOf(yield* store.list(entry.components.mutantId))
        return allHold([
          unreadableUnder(read, verdictKeyOf(entry.components)),
          listed.length === 1,
          Arr.every(listed, isUnreadableListing),
        ])
      }),
  )

  prop(
    '∀t_VerdictStore_≡ATimeoutReproductionOverwritesTheSameKey',
    { of: [TestedEntrySchema], subject: ops },
    (store, [base]) =>
      Effect.gen(function*() {
        const unreproduced: VerdictEntry = { ...base, status: 'Timeout', timeoutKind: 'wallClock', reproductions: 0 }
        const reproduced: VerdictEntry = { ...unreproduced, reproductions: 1 }
        yield* freshStore
        yield* store.put(unreproduced)
        yield* store.put(reproduced)
        const read = yield* store.get(base.components)
        const listed = listedOf(yield* store.list(base.components.mutantId))
        return allHold([finds(read, reproduced), listed.length === 1])
      }),
  )

  prop(
    '∀ec_VerdictStore_≡AListNamesOnlyItsOwnMutantsEntries',
    { of: [VerdictEntrySchema, CheckerEntrySchema], subject: ops },
    (store, [entry, other]) =>
      Effect.gen(function*() {
        const sibling = sameMutant(other, entry.components.mutantId)
        yield* freshStore
        yield* store.put(entry)
        yield* store.put(sibling)
        yield* store.put(other)
        const listed = keysOf(listedOf(yield* store.list(entry.components.mutantId)))
        const ownKeys = Arr.dedupe([verdictKeyOf(entry.components), verdictKeyOf(sibling.components)])
        const expected = other.components.mutantId === entry.components.mutantId
          ? Arr.dedupe([...ownKeys, verdictKeyOf(other.components)])
          : ownKeys
        return sameKeySet(listed, expected)
      }),
  )
}
