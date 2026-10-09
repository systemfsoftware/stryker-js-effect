import type { Options } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Arr from 'effect/Array'
import * as Boolean from 'effect/Boolean'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import { dual } from 'effect/Function'
import * as Option from 'effect/Option'
import * as Path from 'effect/Path'
import * as S from 'effect/Schema'

import { type ReuseReport, ReuseReportSchema } from '../IncrementalDiff.schema.js'
import type { PriorStatus } from '../require-dry-run.workflow.js'

export const optionalField: {
  <A>(field: string, value: A | undefined): Record<string, A>
  <A>(value: A | undefined): (field: string) => Record<string, A>
} = dual(
  2,
  <A>(field: string, value: A | undefined): Record<string, A> =>
    Option.match(Option.fromUndefinedOr(value), {
      onNone: (): Record<string, A> => ({}),
      onSome: (present) => ({ [field]: present }),
    }),
)

export interface IncrementalSourcesInput {
  readonly basePath: string
  readonly options: Options.StrykerOptions
}

const absoluteSourceOf = (path: Path.Path, basePath: string, file: string): string =>
  path.isAbsolute(file) ? file : path.join(basePath, file)

const matchedSourcesOf = Effect.fnUntraced(function*(input: IncrementalSourcesInput) {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const matched = yield* Effect.forEach(
    input.options.incrementalSources,
    (pattern) =>
      fs.glob(pattern, { root: input.basePath }).pipe(
        Effect.orElseSucceed((): readonly string[] => []),
        Effect.map((files) => files.map((file) => absoluteSourceOf(path, input.basePath, file))),
      ),
    { discard: false, concurrency: 1 },
  )
  return matched.flat()
})

export const incrementalSourceFilesOf = Effect.fnUntraced(function*(input: IncrementalSourcesInput) {
  const path = yield* Path.Path
  const incrementalFile = absoluteSourceOf(path, input.basePath, input.options.incrementalFile)
  const matched = yield* Boolean.match(input.options.incremental, {
    onTrue: () => matchedSourcesOf(input),
    onFalse: () => Effect.succeed<readonly string[]>([]),
  })
  return Arr.dedupe([incrementalFile, ...matched])
})

export const incrementalReportTextsOf = Effect.fnUntraced(function*(input: IncrementalSourcesInput) {
  const fs = yield* FileSystem.FileSystem
  const sources = yield* incrementalSourceFilesOf(input)
  return yield* Effect.forEach(
    sources,
    (file) =>
      fs.readFileString(file).pipe(
        Effect.option,
        Effect.map((text) => Option.getOrElse(text, () => '')),
      ),
    { concurrency: 1 },
  )
})

export const reportOfText = (text: string): Option.Option<ReuseReport> =>
  S.decodeOption(S.fromJsonString(ReuseReportSchema))(text)

export const priorStatusesOf = (texts: readonly string[]): readonly PriorStatus[] =>
  texts.flatMap((text) =>
    Option.match(reportOfText(text), {
      onNone: (): readonly PriorStatus[] => [],
      onSome: (report) =>
        Object.values(report.files).flatMap((file) =>
          file.mutants.map((mutant) => ({ mutantId: mutant.id, status: mutant.status }))
        ),
    })
  )
