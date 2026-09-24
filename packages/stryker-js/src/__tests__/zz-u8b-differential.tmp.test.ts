import { it } from '@effect/vitest'
import { Arbitrary } from 'effect/unstable/arbitrary'

import { mergeConfig as baselineMerge } from '../../.u8b-baseline/config.mjs'
import { StrykerConfig } from '../config/stryker-config.schema.js'
import { DocumentSchema } from '../../tests/__fixtures__/config-law.schema.js'

const baseline = baselineMerge as unknown as (defaults: unknown, overrides: unknown) => Record<string, unknown>

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

describe('old vs new merge (dev-time differential, deleted before finish)', () => {
  it.prop('∀do_Whitespace_≡Baseline', [DocumentSchema, DocumentSchema], ([base, overrides]) => {
    const oldMerged = baseline(base, overrides)
    const newMerged = StrykerConfig.merge(base, overrides)
    return sameValue(oldMerged, newMerged) && sameValue(Object.keys(oldMerged), Object.keys(newMerged))
  })

  it.prop('∀do_Poisoned_≡Baseline', [poisonedDocumentArb, poisonedDocumentArb], ([base, overrides]) => {
    const oldMerged = baseline(base, overrides)
    const newMerged = StrykerConfig.merge(base, overrides)
    return sameValue(oldMerged, newMerged) && sameValue(Object.keys(oldMerged), Object.keys(newMerged))
  })

  it.prop('∀d_DataLast_≡Baseline', [DocumentSchema, DocumentSchema], ([base, overrides]) =>
    sameValue(baseline(base, overrides), StrykerConfig.merge(overrides)(base)))

  it.prop('∀c_UndefinedOverride_≡Baseline', [DocumentSchema, DocumentSchema], ([base, overrides]) => {
    const withUndefined = { ...overrides, 'u8b-absent': undefined }
    const oldMerged = baseline(base, withUndefined)
    const newMerged = StrykerConfig.merge(base, withUndefined)
    return sameValue(oldMerged, newMerged) && sameValue(Object.keys(oldMerged), Object.keys(newMerged))
  })
})