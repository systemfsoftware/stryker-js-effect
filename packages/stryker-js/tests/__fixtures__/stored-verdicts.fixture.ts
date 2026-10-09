import { Mutant } from '@systemfsoftware/stryker-js-plugin-interface'
import { type VerdictEntry, VerdictStore } from '@systemfsoftware/stryker-js/verdict-store'
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
}

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

export interface Reseed {
  readonly projectRoot: string
  readonly mutantIds: Iterable<string>
  readonly from: string
  readonly to: string
  readonly rewrite: (entry: VerdictEntry) => VerdictEntry
}

export const reseedVerdicts = (
  { projectRoot, mutantIds, from, to, rewrite }: Reseed,
): Effect.Effect<void, never, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*() {
    const source = yield* storeAt(projectRoot, from)
    const target = yield* storeAt(projectRoot, to)
    const entries = (yield* Effect.forEach(mutantIdsOf(mutantIds), (id) => readableEntriesOf(source, id))).flat()
    yield* Effect.forEach(entries, (entry) => target.put(rewrite(entry)), { discard: true })
  }).pipe(Effect.orDie)
