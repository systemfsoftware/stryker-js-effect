import * as S from 'effect/Schema'

import { VerdictEntrySchema, VerdictKey, VerdictKindSchema } from './VerdictEntry.schema.js'

export class EntryFound extends S.TaggedClass<EntryFound>()('EntryFound', {
  entry: VerdictEntrySchema,
}) {}

export class EntryAbsent extends S.TaggedClass<EntryAbsent>()('EntryAbsent', {}) {}

export class EntryUnreadable extends S.TaggedClass<EntryUnreadable>()('EntryUnreadable', {
  key: VerdictKey,
}) {}

export class StoreUnavailable extends S.TaggedClass<StoreUnavailable>()('StoreUnavailable', {
  reason: S.String,
}) {}

export type GetOutcome = EntryFound | EntryAbsent | EntryUnreadable | StoreUnavailable

export const ListedEntrySchema = S.Union([
  S.TaggedStruct('Readable', { kind: VerdictKindSchema, key: VerdictKey, entry: VerdictEntrySchema }),
  S.TaggedStruct('Unreadable', { kind: VerdictKindSchema, key: VerdictKey }),
])
export type ListedEntry = typeof ListedEntrySchema.Type

export class EntriesListed extends S.TaggedClass<EntriesListed>()('EntriesListed', {
  entries: S.Array(ListedEntrySchema),
}) {}

export type ListOutcome = EntriesListed | StoreUnavailable

export class EntryWritten extends S.TaggedClass<EntryWritten>()('EntryWritten', {
  key: VerdictKey,
}) {}

export class PutSkipped extends S.TaggedClass<PutSkipped>()('PutSkipped', {
  reason: S.String,
}) {}

export type PutOutcome = EntryWritten | PutSkipped

export class VerdictStoreUnavailable extends S.TaggedError<VerdictStoreUnavailable>()('VerdictStoreUnavailable', {
  store: S.String,
  reason: S.String,
}) {
  readonly exitClass = 'ConfigError' as const

  override get message(): string {
    return `The verdict store ${this.store} cannot be used: ${this.reason}`
  }
}

export class VerdictBlobFailed extends S.TaggedError<VerdictBlobFailed>()('VerdictBlobFailed', {
  name: S.String,
  reason: S.String,
}) {
  override get message(): string {
    return `The verdict blob ${this.name} could not be accessed: ${this.reason}`
  }
}
