import type { Options } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as Option from 'effect/Option'
import * as Path from 'effect/Path'

export interface IncrementalSourcesInput {
  readonly basePath: string
  readonly options: Options.StrykerOptions
}

const absoluteSourceOf = (path: Path.Path, basePath: string, file: string): string =>
  path.isAbsolute(file) ? file : path.join(basePath, file)

export const incrementalReportTextsOf = Effect.fnUntraced(function*(input: IncrementalSourcesInput) {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const text = yield* fs.readFileString(absoluteSourceOf(path, input.basePath, input.options.incrementalFile)).pipe(
    Effect.option,
    Effect.map((read) => Option.getOrElse(read, () => '')),
  )
  return [text]
})
