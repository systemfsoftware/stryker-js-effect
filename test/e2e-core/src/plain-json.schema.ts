import * as S from 'effect/Schema'

const PLAIN_KEY = /^[^"\\\p{Cc}\p{Cs}]*$/u

/**
 * nodejs/node#63785: V8 12.4 to 13.6 `JSON.parse` returns the wrong key for a later object once it has parsed a key
 * ending in an escaped backslash. The check sits on the decoded side so the record still selects every key and a key
 * that needs an escape fails at its own path instead of being dropped. Remove it, back to `S.String`, once CI's Node
 * ships v8/v8@93cd21e.
 */
export const PlainJsonKey = S.String.pipe(
  S.decodeTo(
    S.String.check(
      S.isPattern(PLAIN_KEY, {
        expected: 'an object key without a quote, backslash, control character or lone surrogate',
      }),
    ),
  ),
)

export type PlainJson = null | number | boolean | string | ReadonlyArray<PlainJson> | PlainJsonObject

export type PlainJsonObject = { readonly [key: string]: PlainJson }

export const PlainJsonObject: S.Codec<PlainJsonObject> = S.Record(
  PlainJsonKey,
  S.suspend((): S.Codec<PlainJson> => PlainJson),
)

export const PlainJson: S.Codec<PlainJson> = S.Union([
  S.Null,
  S.Finite,
  S.Boolean,
  S.String,
  S.Array(S.suspend((): S.Codec<PlainJson> => PlainJson)),
  PlainJsonObject,
]).annotate({ identifier: 'PlainJson' })
