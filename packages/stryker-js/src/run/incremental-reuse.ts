import type { Options } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as Option from 'effect/Option'
import * as Path from 'effect/Path'
import * as S from 'effect/Schema'

import { IncrementalVersionHeaderSchema } from '../IncrementalReport.schema.js'
import { INCREMENTAL_CACHE_VERSION } from '../verdict-semantics.js'

export interface IncrementalReportTextInput {
  readonly basePath: string
  readonly options: Options.StrykerOptions
}

const absoluteSourceOf = (path: Path.Path, basePath: string, file: string): string =>
  path.isAbsolute(file) ? file : path.join(basePath, file)

const currentLayoutTextOf = (text: string): string =>
  Option.match(
    Option.filter(
      Option.flatMap(
        S.decodeOption(S.fromJsonString(IncrementalVersionHeaderSchema))(text),
        (header) => Option.fromNullishOr(header.incrementalVersion),
      ),
      (version) => version === INCREMENTAL_CACHE_VERSION,
    ),
    {
      onNone: () => '',
      onSome: () => text,
    },
  )

export const incrementalReportTextOf = Effect.fnUntraced(function*(input: IncrementalReportTextInput) {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const text = yield* fs.readFileString(absoluteSourceOf(path, input.basePath, input.options.incrementalFile)).pipe(
    Effect.option,
    Effect.map((read) => Option.getOrElse(read, () => '')),
  )
  return currentLayoutTextOf(text)
})
