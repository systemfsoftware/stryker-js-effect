import * as Predicate from 'effect/Predicate'
import * as Record from 'effect/Record'

import type { StrykerConfig } from './stryker-config.js'

interface MergedConfigRecord<A = unknown> extends Record<string, A | MergedConfigRecord<A>> {}

const usable = <A = unknown>(value: A, key: string): boolean => key !== '__proto__' && value !== undefined

const isConfigRecord = <A = unknown>(
  value: A | MergedConfigRecord<A> | undefined,
): value is MergedConfigRecord<A> => Predicate.isObject(value)

const copyRecord = <A = unknown>(source: MergedConfigRecord<A>): MergedConfigRecord<A> => Record.filter(source, usable)

const mergeNested = <A = unknown>(
  base: MergedConfigRecord<A>,
  override: A | MergedConfigRecord<A>,
): A | MergedConfigRecord<A> => (isConfigRecord(override) ? mergeRecords(base, override) : override)

const mergeKeyInto = <A = unknown>(
  merged: MergedConfigRecord<A>,
  key: string,
  override: A | MergedConfigRecord<A>,
): void => {
  const base = merged[key]
  merged[key] = isConfigRecord(base) ? mergeNested(base, override) : override
}

const mergeRecords = <A = unknown>(
  base: MergedConfigRecord<A>,
  overrides: MergedConfigRecord<A>,
): MergedConfigRecord<A> => {
  const merged = copyRecord(base)
  for (const [key, override] of Object.entries(Record.filter(overrides, usable))) {
    mergeKeyInto(merged, key, override)
  }
  return merged
}

export const mergeConfig = (defaults: StrykerConfig, overrides: StrykerConfig): StrykerConfig =>
  mergeRecords(defaults, overrides)
