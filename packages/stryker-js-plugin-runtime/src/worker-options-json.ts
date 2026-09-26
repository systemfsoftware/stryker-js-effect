import { Option, Predicate, Record } from 'effect'
import type * as S from 'effect/Schema'

const jsonEscapesKey = (key: string): boolean => JSON.stringify(key) !== `"${key}"`

const isJsonArray = (value: S.Json): value is S.JsonArray => Array.isArray(value)

const isJsonObject = (value: S.Json): value is S.JsonObject => Predicate.isObject(value)

const withoutEscapedKeysInRecord = (entries: S.JsonObject): S.Json =>
  Record.fromEntries(
    Record.toEntries(entries)
      .filter(([key]) => !jsonEscapesKey(key))
      .map(([key, entry]) => [key, withoutEscapedKeys(entry)] as const),
  )

const withoutEscapedKeysIn = (value: S.Json): S.Json =>
  Option.match(Option.liftPredicate(value, isJsonObject), {
    onNone: () => value,
    onSome: withoutEscapedKeysInRecord,
  })

export const withoutEscapedKeys = (value: S.Json): S.Json =>
  Option.match(Option.liftPredicate(value, isJsonArray), {
    onNone: () => withoutEscapedKeysIn(value),
    onSome: (items) => items.map(withoutEscapedKeys),
  })
