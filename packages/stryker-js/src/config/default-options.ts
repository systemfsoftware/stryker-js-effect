import { Options } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Effect from 'effect/Effect'
import * as Match from 'effect/Match'
import * as Record from 'effect/Record'
import * as S from 'effect/Schema'

import type { Immutable, Primitive } from './stryker-config.schema.js'

const isNonNullObject = (value: unknown): value is object => typeof value === 'object' && value !== null

const isRecordValue = <A = unknown>(value: unknown): value is Record<string, A> =>
  isNonNullObject(value) && Array.isArray(value) === false

const isArrayValue = <A = unknown>(value: unknown): value is readonly A[] => Array.isArray(value)

const freezeArrayValue = <A = unknown>(value: readonly A[]): ReadonlyArray<Immutable<A>> =>
  Object.freeze(value.map((element) => deepFreeze(element)))

const freezeMapEntry = <K = unknown, V = unknown>(
  [entryKey, entryValue]: readonly [K, V],
): readonly [Immutable<K>, Immutable<V>] => [deepFreeze(entryKey), deepFreeze(entryValue)]

const freezeMapValue = <K = unknown, V = unknown>(value: Map<K, V>): ReadonlyMap<Immutable<K>, Immutable<V>> =>
  Object.freeze(new Map([...value.entries()].map(freezeMapEntry)))

const freezeSetValue = <A = unknown>(value: Set<A>): ReadonlySet<Immutable<A>> =>
  Object.freeze(new Set([...value.values()].map((element) => deepFreeze(element))))

const freezeRegExpValue = (value: RegExp): RegExp => Object.freeze(value)

const freezeRecordValue = <A = unknown>(value: Record<string, A>): Record<string, Immutable<A>> =>
  Object.freeze(Record.map(value, (propertyValue) => deepFreeze(propertyValue)))

function deepFreeze<T>(target: T): Immutable<T>
function deepFreeze(target: object | Primitive): object | Primitive {
  return Match.value(target).pipe(
    Match.when(isArrayValue, freezeArrayValue),
    Match.when(
      <K = unknown, V = unknown>(value: unknown): value is Map<K, V> => value instanceof Map,
      freezeMapValue,
    ),
    Match.when((value: unknown): value is RegExp => value instanceof RegExp, freezeRegExpValue),
    Match.when(
      <A2 = unknown>(value: unknown): value is Set<A2> => value instanceof Set,
      freezeSetValue,
    ),
    Match.when(isRecordValue, freezeRecordValue),
    Match.orElse(() => target),
  )
}

export const createDefaultOptions: Effect.Effect<Options.StrykerOptions> = S.decodeEffect(
  Options.StrykerOptionsSchema,
)({}).pipe(
  Effect.orDie,
)

export const defaultOptions: Effect.Effect<Immutable<Options.StrykerOptions>, never, never> = Effect.map(
  createDefaultOptions,
  (options) => deepFreeze(options),
)
