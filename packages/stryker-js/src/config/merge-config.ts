import * as Predicate from 'effect/Predicate'
import * as Record from 'effect/Record'

import type { StrykerConfig } from './stryker-config.js'

type ConfigRecord = { readonly [key: string]: unknown }

const usable = (value: unknown, key: string): boolean => key !== '__proto__' && value !== undefined

const combineNested = (left: ConfigRecord, right: unknown): unknown => {
  if (Predicate.isObject(right)) {
    return mergeRecords(left, right)
  }
  return right
}

const combine = (left: unknown, right: unknown): unknown => {
  if (Predicate.isObject(left)) {
    return combineNested(left, right)
  }
  return right
}

const mergeRecords = (base: ConfigRecord, overrides: ConfigRecord): ConfigRecord =>
  Record.union(base, Record.filter(overrides, usable), combine)

export const mergeConfig = (defaults: StrykerConfig, overrides: StrykerConfig): StrykerConfig =>
  mergeRecords(defaults, overrides)
