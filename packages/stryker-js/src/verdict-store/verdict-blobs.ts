import type { Mutant } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Arr from 'effect/Array'
import * as Effect from 'effect/Effect'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Order from 'effect/Order'
import * as S from 'effect/Schema'

import {
  type KilledTestedEntry,
  type VerdictComponents,
  type VerdictEntry,
  VerdictEntryJson,
  VerdictKey,
  type VerdictKind,
  VerdictKindSchema,
} from './VerdictEntry.schema.js'
import { verdictKeyOf, type VerdictLocation, verdictLocationAt } from './VerdictKey.js'
import { schemeDirectoryOf, VerdictKeyScheme } from './VerdictKeyScheme.schema.js'
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
  PutSkipped,
  StoreUnavailable,
  type VerdictBlobFailed,
} from './VerdictStore.schema.js'
import type { VerdictStoreShape } from './VerdictStore.service.js'

export interface VerdictBlobs {
  readonly read: (name: string) => Effect.Effect<Option.Option<string>, VerdictBlobFailed>
  readonly write: (name: string, text: string) => Effect.Effect<void, VerdictBlobFailed>
  readonly list: (directory: string) => Effect.Effect<ReadonlyArray<string>, VerdictBlobFailed>
}

const LIST_CONCURRENCY = 8
const ENTRY_FILE_NAME = /^(tested|checker)-([0-9a-f]{64})\.json$/u

const decodeEntry = S.decodeUnknownOption(VerdictEntryJson, { onExcessProperty: 'error' })
const encodeEntry = S.encodeEffect(VerdictEntryJson)
const decodeKind = S.decodeUnknownOption(VerdictKindSchema)
const decodeKey = S.decodeUnknownOption(VerdictKey)

export const entryDirectoryOf: (mutantId: Mutant.MutantId) => string = schemeDirectoryOf(VerdictKeyScheme)

const nameIn = (directory: string, kind: VerdictKind, key: VerdictKey): string => `${directory}/${kind}-${key}.json`

const nameAt = (mutantId: Mutant.MutantId, kind: VerdictKind, key: VerdictKey): string =>
  nameIn(entryDirectoryOf(mutantId), kind, key)

const locatedNameOf = (components: VerdictComponents, location: VerdictLocation): string =>
  nameIn(location.directory, components._tag, location.key)

export const entryNameAt = (scheme: VerdictKeyScheme) => (components: VerdictComponents): string =>
  locatedNameOf(components, verdictLocationAt(scheme)(components))

export const entryNameOf: (components: VerdictComponents) => string = entryNameAt(VerdictKeyScheme)

const currentLocationOf: (components: VerdictComponents) => VerdictLocation = verdictLocationAt(VerdictKeyScheme)

interface EntryFileName {
  readonly kind: VerdictKind
  readonly key: VerdictKey
}

const entryFileNameOf = (fileName: string): Option.Option<EntryFileName> =>
  Option.flatMap(
    Option.fromNullishOr(ENTRY_FILE_NAME.exec(fileName)),
    (match) => Option.all({ kind: decodeKind(match[1]), key: decodeKey(match[2]) }),
  )

const entryAt = (text: string, file: EntryFileName): Option.Option<VerdictEntry> =>
  Option.filter(decodeEntry(text), (entry) => verdictKeyOf(entry.components) === file.key)

const unavailable = (failure: VerdictBlobFailed) => Effect.succeed(StoreUnavailable.make({ reason: failure.reason }))

const getOf = (blobs: VerdictBlobs) => (components: VerdictComponents): Effect.Effect<GetOutcome> => {
  const location = currentLocationOf(components)
  const file: EntryFileName = { kind: components._tag, key: location.key }
  return blobs.read(locatedNameOf(components, location)).pipe(
    Effect.map((text): GetOutcome =>
      Option.match(text, {
        onNone: () => EntryAbsent.make({}),
        onSome: (present) =>
          Option.match(entryAt(present, file), {
            onNone: (): GetOutcome => EntryUnreadable.make({ key: file.key }),
            onSome: (entry): GetOutcome => EntryFound.make({ entry }),
          }),
      })
    ),
    Effect.catchTag('VerdictBlobFailed', unavailable),
  )
}

const listedOf = (
  blobs: VerdictBlobs,
  mutantId: Mutant.MutantId,
  file: EntryFileName,
): Effect.Effect<Option.Option<ListedEntry>, VerdictBlobFailed> =>
  Effect.map(
    blobs.read(nameAt(mutantId, file.kind, file.key)),
    Option.map((text): ListedEntry =>
      Option.match(entryAt(text, file), {
        onNone: (): ListedEntry => ({ _tag: 'Unreadable', kind: file.kind, key: file.key }),
        onSome: (entry): ListedEntry => ({ _tag: 'Readable', kind: file.kind, key: file.key, entry }),
      })
    ),
  )

const listOf = (blobs: VerdictBlobs) => (mutantId: Mutant.MutantId): Effect.Effect<ListOutcome> =>
  blobs.list(entryDirectoryOf(mutantId)).pipe(
    Effect.flatMap((names) =>
      Effect.forEach(
        Arr.getSomes(names.map(entryFileNameOf)),
        (file) => listedOf(blobs, mutantId, file),
        { concurrency: LIST_CONCURRENCY },
      )
    ),
    Effect.map((listed): ListOutcome => EntriesListed.make({ entries: Arr.getSomes(listed) })),
    Effect.catchTag('VerdictBlobFailed', unavailable),
  )

const putOf = (blobs: VerdictBlobs) => (entry: VerdictEntry): Effect.Effect<PutOutcome> => {
  const location = currentLocationOf(entry.components)
  const key = location.key
  return encodeEntry(entry).pipe(
    Effect.mapError((error) => `the entry does not encode: ${error.message}`),
    Effect.flatMap((text) =>
      blobs.write(locatedNameOf(entry.components, location), text).pipe(
        Effect.mapError((failure) => failure.reason),
      )
    ),
    Effect.match({
      onFailure: (reason): PutOutcome => PutSkipped.make({ reason }),
      onSuccess: (): PutOutcome => EntryWritten.make({ key }),
    }),
  )
}

const newestFirst: Order.Order<VerdictEntry> = Order.mapInput(Order.flip(Order.Number), (entry) => entry.settledAt)

const isKilled = (entry: VerdictEntry): entry is KilledTestedEntry => entry.status === 'Killed'

const killedByOf = (entry: VerdictEntry): ReadonlyArray<string> =>
  Option.liftPredicate(entry, isKilled).pipe(
    Option.flatMap((killed) => Option.fromUndefinedOr(killed.killedBy)),
    Option.getOrElse((): ReadonlyArray<string> => []),
  )

const readableEntryOf = (listed: ListedEntry): ReadonlyArray<VerdictEntry> =>
  Match.valueTags(listed, {
    Readable: ({ entry }): ReadonlyArray<VerdictEntry> => [entry],
    Unreadable: (): ReadonlyArray<VerdictEntry> => [],
  })

export const readableEntriesOf = (outcome: ListOutcome): ReadonlyArray<VerdictEntry> =>
  Match.valueTags(outcome, {
    EntriesListed: ({ entries }) => entries.flatMap(readableEntryOf),
    StoreUnavailable: (): ReadonlyArray<VerdictEntry> => [],
  })

const killingTestsOf = (blobs: VerdictBlobs) => (mutantId: Mutant.MutantId): Effect.Effect<ReadonlyArray<string>> =>
  Effect.map(
    listOf(blobs)(mutantId),
    (outcome) => Arr.dedupe(Arr.sort(readableEntriesOf(outcome), newestFirst).flatMap(killedByOf)),
  )

export const makeVerdictStore = (blobs: VerdictBlobs): VerdictStoreShape => ({
  get: getOf(blobs),
  put: putOf(blobs),
  list: listOf(blobs),
  killingTests: killingTestsOf(blobs),
})
