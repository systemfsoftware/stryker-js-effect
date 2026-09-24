import { describe, it } from '@effect/vitest'
import { Arbitrary } from 'effect/unstable/arbitrary'

import { type DocumentRecord, StrykerConfig } from '../config/stryker-config.schema.js'
import { DocumentSchema, NestedDocumentSchema } from '../../tests/__fixtures__/config-law.schema.js'

const poisonedDocumentArb = Arbitrary.schema(DocumentSchema).pipe(
  Arbitrary.map((document) => ({
    ...document,
    ...Object.fromEntries([['__proto__', Object.fromEntries([['polluted', true]])]]),
  })),
)

const isOptionRecord = (
  value: typeof DocumentSchema.Type | typeof NestedDocumentSchema.Type[keyof typeof NestedDocumentSchema.Type],
): value is DocumentRecord => typeof value === 'object' && value !== null && Array.isArray(value) === false

const sameArrayElements = (
  left: ReadonlyArray<typeof DocumentSchema.Type[keyof typeof DocumentSchema.Type]>,
  right: ReadonlyArray<typeof DocumentSchema.Type[keyof typeof DocumentSchema.Type]>,
): boolean => left.length === right.length && left.every((element, index) => sameElement(element, right[index]))

const sameEntries = (left: DocumentRecord, right: DocumentRecord): boolean => {
  const leftNames = Object.keys(left).filter((name) => left[name] !== undefined)
  const rightNames = Object.keys(right).filter((name) => right[name] !== undefined)
  return leftNames.length === rightNames.length &&
    leftNames.every((name) => name in right && sameValue(left[name], right[name]))
}

const sameElement = (
  left: typeof DocumentSchema.Type[keyof typeof DocumentSchema.Type],
  right: typeof DocumentSchema.Type[keyof typeof DocumentSchema.Type],
): boolean =>
  left === right ||
  (isOptionRecord(left) && isOptionRecord(right) && sameEntries(left, right))

const sameValue = (
  left:
    | typeof DocumentSchema.Type
    | typeof DocumentSchema.Type[keyof typeof DocumentSchema.Type]
    | typeof NestedDocumentSchema.Type[keyof typeof NestedDocumentSchema.Type],
  right:
    | typeof DocumentSchema.Type
    | typeof DocumentSchema.Type[keyof typeof DocumentSchema.Type]
    | typeof NestedDocumentSchema.Type[keyof typeof NestedDocumentSchema.Type],
): boolean =>
  left === right ||
  (Array.isArray(left) && Array.isArray(right) && sameArrayElements(left, right)) ||
  (isOptionRecord(left) && isOptionRecord(right) && sameEntries(left, right))

const statedKeys = (document: DocumentRecord): ReadonlyArray<string> =>
  Object.keys(document).filter((key) => key !== '__proto__' && document[key] !== undefined)

const usableEntriesOnly = (document: typeof DocumentSchema.Type): typeof DocumentSchema.Type =>
  Object.fromEntries(Object.entries(document).filter(([key, value]) => key !== '__proto__' && value !== undefined))

describe('StrykerConfig.merge', () => {
  it.prop('∀d_Merge_empty_≡KeepsEveryEntryInOrder', [DocumentSchema], ([document]) =>
    sameValue(StrykerConfig.merge(document, {}), usableEntriesOnly(document)))

  it.prop('∀do_Merge_≡StatedKeyWins', [DocumentSchema, DocumentSchema], ([base, overrides]) => {
    const merged = StrykerConfig.merge(base, overrides)
    return Object.keys(overrides).every((key) =>
      overrides[key] === undefined || key === '__proto__'
        ? sameValue(merged[key], usableEntriesOnly(base)[key])
        : sameValue(merged[key], overrides[key])
    )
  })

  it.prop('∀do_Merge_≡BaseKeysFirstThenNewOverrideKeys', [DocumentSchema, DocumentSchema], ([base, overrides]) => {
    const kept = usableEntriesOnly(base)
    const expected = { ...usableEntriesOnly(overrides), ...kept }
    const mergedKeys = Object.keys(StrykerConfig.merge(base, overrides))
    return mergedKeys.length === Object.keys(expected).length &&
      mergedKeys.every((key) => key in expected)
  })

  it.prop('∀do_Merge_≡Idempotent', [NestedDocumentSchema, NestedDocumentSchema], ([base, overrides]) => {
    const once = StrykerConfig.merge(base, overrides)
    const twice = StrykerConfig.merge(once, overrides)
    return sameValue(Object.keys(twice), Object.keys(twice).filter((key) => key in once)) &&
      Object.keys(overrides).every((key) =>
        overrides[key] === undefined || key === '__proto__'
          ? sameValue(usableEntriesOnly(twice)[key], usableEntriesOnly(once)[key])
          : sameValue(twice[key], overrides[key])
      )
  })

  it.prop('∀do_Merge_≡NestedRecordsMergeRecursively', [NestedDocumentSchema, NestedDocumentSchema], ([base, overrides]) => {
    const merged = StrykerConfig.merge(base, overrides)
    return Object.keys(overrides).every((key) => {
      const override = overrides[key]
      if (override === undefined) {
        return sameValue(merged[key], base[key])
      }
      const mergedValue = merged[key]
      if (isOptionRecord(override) === false) {
        return sameValue(mergedValue, override)
      }
      if (isOptionRecord(mergedValue) === false) {
        return false
      }
      return Object.keys(override).every((child) =>
        override[child] === undefined ? true : sameValue(mergedValue[child], override[child])
      )
    })
  })

  it.prop('∀do_Merge_∈DocumentKeysNeverReachThePrototype', [poisonedDocumentArb, poisonedDocumentArb], ([base, overrides]) => {
    const merged = StrykerConfig.merge(base, overrides)
    return Object.getOwnPropertyNames(merged).includes('__proto__') === false &&
      Object.getPrototypeOf(merged) === Object.prototype &&
      Object.getOwnPropertyNames(Object.prototype).includes('polluted') === false
  })
})