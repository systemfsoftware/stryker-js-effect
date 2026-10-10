import type { Mutant } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Arr from 'effect/Array'
import * as Effect from 'effect/Effect'
import { dual } from 'effect/Function'
import * as Order from 'effect/Order'

import { readableEntriesOf } from '../verdict-store/verdict-blobs.js'
import type { VerdictEntry } from '../verdict-store/VerdictEntry.schema.js'
import type { VerdictStoreShape } from '../verdict-store/VerdictStore.service.js'

const LIST_CONCURRENCY = 16

export const priorEntriesOf: {
  (mutantIds: Iterable<Mutant.MutantId>): (store: VerdictStoreShape) => Effect.Effect<ReadonlyArray<VerdictEntry>>
  (store: VerdictStoreShape, mutantIds: Iterable<Mutant.MutantId>): Effect.Effect<ReadonlyArray<VerdictEntry>>
} = dual(
  2,
  (store: VerdictStoreShape, mutantIds: Iterable<Mutant.MutantId>): Effect.Effect<ReadonlyArray<VerdictEntry>> =>
    Effect.forEach(mutantIds, (mutantId) => Effect.map(store.list(mutantId), readableEntriesOf), {
      concurrency: LIST_CONCURRENCY,
    }).pipe(Effect.map(Arr.flatten)),
)

const oldestFirst: Order.Order<VerdictEntry> = Order.mapInput(Order.Number, (entry) => entry.settledAt)

export const newestCostsOf = (entries: ReadonlyArray<VerdictEntry>): Readonly<Record<string, number>> =>
  Object.fromEntries(Arr.sort(entries, oldestFirst).map((entry) => [entry.components.mutantId, entry.costMs] as const))
