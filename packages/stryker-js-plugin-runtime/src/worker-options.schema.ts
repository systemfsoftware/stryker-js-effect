import { Options } from '@systemfsoftware/stryker-js-plugin-interface'
import { SchemaGetter, SchemaTransformation } from 'effect'
import * as Option from 'effect/Option'
import * as S from 'effect/Schema'

const isEscapedKey = (key: string): boolean => JSON.stringify(key) !== `"${key}"`

const omitEscapedKeys = (key: string, value: S.Json): S.Json | undefined => (isEscapedKey(key) ? undefined : value)

const withoutEscapedKeys = (options: Options.StrykerOptions): Options.StrykerOptions =>
  Option.getOrThrow(
    S.decodeUnknownOption(Options.StrykerOptionsSchema)(JSON.parse(JSON.stringify(options, omitEscapedKeys))),
  )

const OptionsLawDomain = S.declare<Options.StrykerOptions>(
  (value): value is Options.StrykerOptions => S.is(Options.StrykerOptionsSchema)(value),
  {
    toCodecArbitrary: () =>
      S.link<Options.StrykerOptions>()(Options.StrykerOptionsSchema, {
        decode: SchemaGetter.transform(withoutEscapedKeys),
        encode: SchemaGetter.passthrough(),
      }),
  },
)

export const WorkerOptionsWire = S.fromJsonString(
  Options.StrykerOptionsSchema.pipe(S.decodeTo(OptionsLawDomain, SchemaTransformation.passthrough())),
)
