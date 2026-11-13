import * as S from 'effect/Schema'

import { VerdictEntrySchema, VerdictKey, VerdictKindSchema } from './VerdictEntry.schema.js'

export class EntryFound extends S.TaggedClass<EntryFound, { readonly brand: unique symbol }>()('EntryFound', {
  entry: VerdictEntrySchema,
}) {}

export class EntryAbsent extends S.TaggedClass<EntryAbsent, { readonly brand: unique symbol }>()('EntryAbsent', {}) {}

export class EntryUnreadable
  extends S.TaggedClass<EntryUnreadable, { readonly brand: unique symbol }>()('EntryUnreadable', {
    key: VerdictKey,
  })
{}

export class StoreUnavailable
  extends S.TaggedClass<StoreUnavailable, { readonly brand: unique symbol }>()('StoreUnavailable', {
    reason: S.String,
  })
{}

export type GetOutcome = EntryFound | EntryAbsent | EntryUnreadable | StoreUnavailable

export const ListedEntrySchema = S.Union([
  S.TaggedStruct('Readable', { kind: VerdictKindSchema, key: VerdictKey, entry: VerdictEntrySchema }),
  S.TaggedStruct('Unreadable', { kind: VerdictKindSchema, key: VerdictKey }),
])
export type ListedEntry = typeof ListedEntrySchema.Type

export class EntriesListed extends S.TaggedClass<EntriesListed, { readonly brand: unique symbol }>()('EntriesListed', {
  entries: S.Array(ListedEntrySchema),
}) {}

export type ListOutcome = EntriesListed | StoreUnavailable

export class EntryWritten extends S.TaggedClass<EntryWritten, { readonly brand: unique symbol }>()('EntryWritten', {
  key: VerdictKey,
}) {}

export class PutSkipped extends S.TaggedClass<PutSkipped, { readonly brand: unique symbol }>()('PutSkipped', {
  reason: S.String,
}) {}

export type PutOutcome = EntryWritten | PutSkipped

export class VerdictStoreUnavailable
  extends S.TaggedError<VerdictStoreUnavailable, { readonly brand: unique symbol }>()('VerdictStoreUnavailable', {
    store: S.String,
    reason: S.String,
  })
{
  readonly exitClass = 'ConfigError' as const

  override get message(): string {
    return `The verdict store ${this.store} cannot be used: ${this.reason}`
  }
}

export class VerdictBlobFailed
  extends S.TaggedError<VerdictBlobFailed, { readonly brand: unique symbol }>()('VerdictBlobFailed', {
    blob: S.String,
    reason: S.String,
  })
{
  override get message(): string {
    return `The verdict blob ${this.blob} could not be accessed: ${this.reason}`
  }
}
