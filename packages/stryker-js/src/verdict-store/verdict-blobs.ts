import type { Mutant } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Arr from 'effect/Array'
import * as Effect from 'effect/Effect'
import * as Option from 'effect/Option'
import * as S from 'effect/Schema'

import {
  type VerdictComponents,
  type VerdictEntry,
  VerdictEntryJson,
  VerdictKey,
  type VerdictKind,
  VerdictKindSchema,
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

const LAYOUT_DIRECTORY = 'v1'
const LIST_CONCURRENCY = 8
const ENTRY_FILE_NAME = /^(tested|checker)-([0-9a-f]{64})\.json$/u

const decodeEntry = S.decodeUnknownOption(VerdictEntryJson)
const encodeEntry = S.encodeEffect(VerdictEntryJson)
const decodeKind = S.decodeUnknownOption(VerdictKindSchema)
const decodeKey = S.decodeUnknownOption(VerdictKey)

export const entryDirectoryOf = (mutantId: Mutant.MutantId): string => `${LAYOUT_DIRECTORY}/${mutantId}`

const nameAt = (mutantId: Mutant.MutantId, kind: VerdictKind, key: VerdictKey): string =>
  `${entryDirectoryOf(mutantId)}/${kind}-${key}.json`

export const entryNameOf = (components: VerdictComponents): string =>
  nameAt(components.mutantId, components._tag, verdictKeyOf(components))

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
  const file: EntryFileName = { kind: components._tag, key: verdictKeyOf(components) }
  return blobs.read(nameAt(components.mutantId, file.kind, file.key)).pipe(
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
  const key = verdictKeyOf(entry.components)
  return encodeEntry(entry).pipe(
    Effect.mapError((error) => `the entry does not encode: ${error.message}`),
    Effect.flatMap((text) =>
      blobs.write(nameAt(entry.components.mutantId, entry.components._tag, key), text).pipe(
        Effect.mapError((failure) => failure.reason),
      )
    ),
    Effect.match({
      onFailure: (reason): PutOutcome => PutSkipped.make({ reason }),
      onSuccess: (): PutOutcome => EntryWritten.make({ key }),
    }),
  )
}

export const makeVerdictStore = (blobs: VerdictBlobs): VerdictStoreShape => ({
  get: getOf(blobs),
  put: putOf(blobs),
  list: listOf(blobs),
})
