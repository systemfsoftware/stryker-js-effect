import { Mutant } from '@systemfsoftware/stryker-js-plugin-interface'
import { CheckerEntrySchema, type VerdictEntry, VerdictStore } from '@systemfsoftware/stryker-js/verdict-store'
import { fsVerdictStoreLayer } from '@systemfsoftware/stryker-js/verdict-store/fs'
import * as Arr from 'effect/Array'
import * as Effect from 'effect/Effect'
import type * as FileSystem from 'effect/FileSystem'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Order from 'effect/Order'
import * as Path from 'effect/Path'
import * as S from 'effect/Schema'

export const DEFAULT_VERDICT_DIRECTORY = 'reports/stryker-verdicts'

export interface StoredVerdict {
  readonly status: string
  readonly costMs: number
  readonly settledAt: number
  readonly programDigest: string | undefined
}

const programDigestOf = (entry: VerdictEntry): string | undefined =>
  Option.getOrUndefined(
    Option.map(Option.liftPredicate(entry, S.is(CheckerEntrySchema)), (checker) => checker.components.programDigest),
  )

const readableEntriesOf = (store: typeof VerdictStore.Service, mutantId: Mutant.MutantId) =>
  Effect.map(store.list(mutantId), (outcome) =>
    Match.valueTags(outcome, {
      EntriesListed: ({ entries }) =>
        entries.flatMap((listed) =>
          Match.valueTags(listed, { Readable: ({ entry }) => [entry], Unreadable: (): VerdictEntry[] => [] })
        ),
      StoreUnavailable: (): VerdictEntry[] => [],
    }))

const newestFirst: Order.Order<VerdictEntry> = Order.flip(Order.mapInput(Order.Number, (entry) => entry.settledAt))

const newestOf = (store: typeof VerdictStore.Service, mutantId: Mutant.MutantId) =>
  Effect.map(
    readableEntriesOf(store, mutantId),
    (entries): Option.Option<StoredVerdict> =>
      Option.map(Arr.head(Arr.sort(entries, newestFirst)), (entry) => ({
        status: entry.status,
        costMs: entry.costMs,
        settledAt: entry.settledAt,
        programDigest: programDigestOf(entry),
      })),
  )

const storeAt = (projectRoot: string, directory: string) =>
  Effect.flatMap(
    Path.Path,
    (path) => Effect.provide(Effect.service(VerdictStore), fsVerdictStoreLayer(path.join(projectRoot, directory))),
  )

const mutantIdsOf = (ids: Iterable<string>): ReadonlyArray<Mutant.MutantId> =>
  [...ids].flatMap((id) => Option.toArray(S.decodeOption(Mutant.MutantId)(id)))

export interface StoredVerdictsQuery {
  readonly projectRoot: string
  readonly mutantIds: Iterable<string>
  readonly directory?: string
}

export const storedVerdictsIn = (
  { projectRoot, mutantIds, directory = DEFAULT_VERDICT_DIRECTORY }: StoredVerdictsQuery,
): Effect.Effect<Readonly<Record<string, StoredVerdict>>, never, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*() {
    const store = yield* storeAt(projectRoot, directory)
    const found = yield* Effect.forEach(
      mutantIdsOf(mutantIds),
      (id) => Effect.map(newestOf(store, id), Option.map((stored) => [id, stored] as const)),
    )
    return Object.fromEntries(found.flatMap(Option.toArray))
  }).pipe(Effect.orDie)

export interface StoreLocation {
  readonly projectRoot: string
  readonly directory?: string
}

export interface Reseed {
  readonly mutantIds: Iterable<string>
  readonly from: StoreLocation
  readonly to: StoreLocation
  readonly rewrite?: (entry: VerdictEntry) => VerdictEntry
}

const storeIn = ({ projectRoot, directory = DEFAULT_VERDICT_DIRECTORY }: StoreLocation) =>
  storeAt(projectRoot, directory)

export const reseedVerdicts = (
  { mutantIds, from, to, rewrite = (entry) => entry }: Reseed,
): Effect.Effect<void, never, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*() {
    const source = yield* storeIn(from)
    const target = yield* storeIn(to)
    const entries = (yield* Effect.forEach(mutantIdsOf(mutantIds), (id) => readableEntriesOf(source, id))).flat()
    yield* Effect.forEach(entries, (entry) => target.put(rewrite(entry)), { discard: true })
  }).pipe(Effect.orDie)
