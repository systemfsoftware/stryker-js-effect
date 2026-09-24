import { describe, it } from '@effect/vitest'
import type { PartialStrykerOptions } from '@systemfsoftware/stryker-js-plugin-interface'
import * as S from 'effect/Schema'

import { StrykerConfig } from '../config/stryker-config.schema.js'

const ConfigDocument = S.Record(S.String, S.Unknown)

const definedEntriesOf = (document: PartialStrykerOptions): ReadonlyArray<readonly [string, unknown]> =>
  Object.entries(document).filter(([, value]) => value !== undefined)

const rightEntrySurvives = (
  defaults: PartialStrykerOptions,
  overrides: PartialStrykerOptions,
  key: string,
): boolean => {
  const merged = StrykerConfig.merge(defaults, overrides) as Record<string, unknown>
  const stated = (overrides as Record<string, unknown>)[key]
  return merged[key] !== undefined && stated !== undefined && JSON.stringify(merged[key]) === JSON.stringify(stated)
}

describe('StrykerConfig.merge', () => {
  it.prop('∀lr_Merge_≡RightWins', [ConfigDocument, ConfigDocument], ([left, right]) => {
    const defaults = left as PartialStrykerOptions
    const overrides = right as PartialStrykerOptions
    return definedEntriesOf(overrides).every(([key]) => rightEntrySurvives(defaults, overrides, key))
  })
  it.prop('∀d_Merge_≡EmptyRightIsIdentity', [ConfigDocument], ([document]) => {
    const defaults = document as PartialStrykerOptions
    const merged = StrykerConfig.merge(defaults, {})
    const mergedAgain = StrykerConfig.merge(merged, defaults)
    return definedEntriesOf(defaults).every(
      ([key]) => JSON.stringify((merged as Record<string, unknown>)[key]) !== 'undefined',
    ) && JSON.stringify(merged) === JSON.stringify(mergedAgain)
  })
})
