import { Options } from '@systemfsoftware/stryker-js-plugin-interface'
import { Option, SchemaGetter, SchemaTransformation } from 'effect'
import * as S from 'effect/Schema'

import { withoutEscapedKeys } from './worker-options-json.js'

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
