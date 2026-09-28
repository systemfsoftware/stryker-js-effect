import { Options } from '@systemfsoftware/stryker-js-plugin-interface'
import { Option, Predicate, Record, SchemaGetter, SchemaTransformation } from 'effect'
import * as S from 'effect/Schema'

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

const withoutEscapedKeys = (value: S.Json): S.Json =>
  Option.match(Option.liftPredicate(value, isJsonArray), {
    onNone: () => withoutEscapedKeysIn(value),
    onSome: (items) => items.map(withoutEscapedKeys),
  })

const escapedKeyFreeSample = SchemaGetter.transformOptional(
  (sample: Option.Option<Options.StrykerOptions>) =>
    Option.flatMap(sample, (options) => Option.map(S.decodeUnknownOption(S.Json)(options), withoutEscapedKeys)),
)

const OptionsLawDomain = S.declare<Options.StrykerOptions>(
  (value): value is Options.StrykerOptions => S.is(Options.StrykerOptionsSchema)(value),
  {
    toCodecArbitrary: () =>
      S.link<S.Json>()(Options.StrykerOptionsSchema, {
        decode: escapedKeyFreeSample,
        encode: SchemaGetter.passthrough({ strict: false }),
      }),
  },
)

export const WorkerOptionsWire = S.fromJsonString(
  Options.StrykerOptionsSchema.pipe(S.decodeTo(OptionsLawDomain, SchemaTransformation.passthrough())),
)
