import { describe, it } from '@effect/vitest'
import { Arbitrary } from 'effect/unstable/arbitrary'

import { StrykerConfig } from '../config/stryker-config.schema.js'
import { DocumentSchema, NestedDocumentSchema } from '../../tests/__fixtures__/config-law.schema.js'

const poisonedDocumentArb = Arbitrary.schema(DocumentSchema).pipe(
  Arbitrary.map((document) => ({
    ...document,
    ...Object.fromEntries([['__proto__', Object.fromEntries([['polluted', true]])]]),
  })),
)

const isOptionRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && Array.isArray(value) === false

const sameEntries = (left: Record<string, unknown>, right: Record<string, unknown>): boolean => {
  const names = Object.keys(left)
  return names.length === Object.keys(right).length &&
    names.every((name) => name in right && sameValue(left[name], right[name]))
}

const sameValue = (left: unknown, right: unknown): boolean =>
  left === right ||
  (Array.isArray(left) && Array.isArray(right) && left.length === right.length &&
    left.every((element, index) => sameValue(element, right[index]))) ||
  (isOptionRecord(left) && isOptionRecord(right) && sameEntries(left, right))

const statedKeys = (document: { readonly [key: string]: unknown }): readonly string[] =>
  Object.keys(document).filter((key) => document[key] !== undefined)

describe('StrykerConfig.merge', () => {
  it.prop('∀d_Merge_empty_≡KeepsEveryEntryInOrder', [DocumentSchema], ([document]) =>
    sameValue(StrykerConfig.merge(document, {}), document))

  it.prop('∀do_Merge_≡StatedKeyWins', [DocumentSchema, DocumentSchema], ([base, overrides]) => {
    const merged = StrykerConfig.merge(base, overrides)
    return Object.keys(overrides).every((key) =>
      overrides[key] === undefined ? sameValue(merged[key], base[key]) : sameValue(merged[key], overrides[key])
    )
  })

  it.prop('∀do_Merge_≡BaseKeysFirstThenNewOverrideKeys', [DocumentSchema, DocumentSchema], ([base, overrides]) => {
    const kept = statedKeys(base)
    const expected = [...kept, ...statedKeys(overrides).filter((key) => kept.includes(key) === false)]
    return sameValue(Object.keys(StrykerConfig.merge(base, overrides)), expected)
  })

  it.prop('∀do_Merge_≡Idempotent', [NestedDocumentSchema, NestedDocumentSchema], ([base, overrides]) =>
    sameValue(
      StrykerConfig.merge(StrykerConfig.merge(base, overrides), overrides),
      StrykerConfig.merge(base, overrides),
    ))

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