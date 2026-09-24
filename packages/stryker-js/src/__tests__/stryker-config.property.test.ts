import { describe, it } from '@effect/vitest'
import * as Arr from 'effect/Array'
import * as Predicate from 'effect/Predicate'
import { Arbitrary } from 'effect/unstable/arbitrary'

import { type DocumentRecord, mergeRecords } from '../config/merge-records.js'
import { DocumentSchema, NestedDocumentSchema } from '../../tests/__fixtures__/config-law.schema.js'

const poisonedDocumentArb = Arbitrary.schema(DocumentSchema).pipe(
  Arbitrary.map((document) => ({
    ...document,
    ...Object.fromEntries([['__proto__', Object.fromEntries([['polluted', true]])]]),
  })),
)

const isDocumentRecord = (value: unknown): value is DocumentRecord =>
  Predicate.isObject(value) && Arr.isArray(value) === false

const sameEntries = (left: DocumentRecord, right: DocumentRecord): boolean => {
  const leftNames = Object.keys(left).filter((name) => left[name] !== undefined)
  const rightNames = Object.keys(right).filter((name) => right[name] !== undefined)
  return leftNames.length === rightNames.length &&
    leftNames.every((name) => name in right && sameValue(left[name], right[name]))
}

const sameElements = (left: ReadonlyArray<unknown>, right: ReadonlyArray<unknown>): boolean =>
  left.length === right.length && left.every((element, index) => sameValue(element, right[index]))

const sameValue = (left: unknown, right: unknown): boolean =>
  left === right ||
  (Arr.isArray(left) && Arr.isArray(right) && sameElements(left, right)) ||
  (isDocumentRecord(left) && isDocumentRecord(right) && sameEntries(left, right))

const statedKeys = (document: DocumentRecord): ReadonlyArray<string> =>
  Object.keys(document).filter((key) => key !== '__proto__' && document[key] !== undefined)

const usableEntriesOnly = (document: typeof DocumentSchema.Type): typeof DocumentSchema.Type =>
  Object.fromEntries(Object.entries(document).filter(([key, value]) => key !== '__proto__' && value !== undefined))

describe('mergeRecords', () => {
  it.prop('∀d_Merge_empty_≡KeepsEveryEntryInOrder', [DocumentSchema], ([document]) =>
    sameValue(mergeRecords(document, {}), usableEntriesOnly(document)))

  it.prop('∀do_Merge_≡StatedKeyWins', [DocumentSchema, DocumentSchema], ([base, overrides]) => {
    const merged = mergeRecords(base, overrides)
    return Object.keys(overrides).every((key) =>
      overrides[key] === undefined || key === '__proto__'
        ? sameValue(merged[key], usableEntriesOnly(base)[key])
        : sameValue(merged[key], overrides[key])
    )
  })

  it.prop('∀do_Merge_≡BaseKeysFirstThenNewOverrideKeys', [DocumentSchema, DocumentSchema], ([base, overrides]) => {
    const kept = usableEntriesOnly(base)
    const expected = { ...usableEntriesOnly(overrides), ...kept }
    const mergedKeys = Object.keys(mergeRecords(base, overrides))
    return mergedKeys.length === Object.keys(expected).length &&
      mergedKeys.every((key) => key in expected)
  })

  it.prop('∀do_Merge_≡Idempotent', [DocumentSchema, DocumentSchema], ([base, overrides]) =>
    sameValue(
      mergeRecords(mergeRecords(base, overrides), overrides),
      mergeRecords(base, overrides),
    ))

  it.prop('∀do_Merge_≡NestedRecordsMergeRecursively', [NestedDocumentSchema, NestedDocumentSchema], ([base, overrides]) => {
    const kept = usableEntriesOnly(base)
    const merged = mergeRecords(base, overrides)
    return statedKeys(overrides).every((key) => {
      const override = overrides[key]
      const mergedValue = merged[key]
      if (isDocumentRecord(override) === false) {
        return sameValue(mergedValue, override)
      }
      if (isDocumentRecord(mergedValue) === false) {
        return false
      }
      return statedKeys(override).every((child) => sameValue(mergedValue[child], override[child]))
    }) && statedKeys(kept).every((key) => key in merged)
  })

  it.prop('∀do_Merge_∈DocumentKeysNeverReachThePrototype', [poisonedDocumentArb, poisonedDocumentArb], ([base, overrides]) => {
    const merged = mergeRecords(base, overrides)
    return Object.getOwnPropertyNames(merged).includes('__proto__') === false &&
      Object.getPrototypeOf(merged) === Object.prototype &&
      Object.getOwnPropertyNames(Object.prototype).includes('polluted') === false
  })
})