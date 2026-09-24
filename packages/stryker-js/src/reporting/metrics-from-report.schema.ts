import {
  type FileResult,
  FileResultDictionarySchema,
  Metrics,
  MetricsResultSchema,
} from '@systemfsoftware/stryker-js-plugin-interface'
import * as Arr from 'effect/Array'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as S from 'effect/Schema'
import * as SGetter from 'effect/SchemaGetter'

type SegmentGroups = Readonly<Record<string, ReadonlyArray<readonly [string, FileResult]>>>

const segmentOf = (fileName: string): string =>
  Match.value(fileName.indexOf('/')).pipe(
    Match.when((separator) => separator < 0, () => fileName),
    Match.orElse((separator) => fileName.slice(0, separator)),
  )

const groupBySegment = (files: Readonly<Record<string, FileResult>>): SegmentGroups =>
  Arr.groupBy(Object.entries(files), ([fileName]) => segmentOf(fileName))

const metricsOf = (files: Readonly<Record<string, FileResult>>): Metrics =>
  Metrics.fromMutants(Arr.flatMap(Object.values(files), (file) => file.mutants))

const fileResultOf = (fileName: string, file: FileResult): typeof MetricsResultSchema.Type => ({
  name: fileName,
  metrics: Metrics.fromMutants(file.mutants),
  childResults: [],
})

const nestedGroupResult = (
  segment: string,
  entries: readonly (readonly [string, FileResult])[],
): typeof MetricsResultSchema.Type => {
  const nested = Object.fromEntries(entries.map(([fileName, file]) => [fileName.slice(segment.length + 1), file]))
  return { name: segment, metrics: metricsOf(nested), childResults: childResultsOf(nested) }
}

const soleSegmentFileResult = (
  segment: string,
  entries: readonly (readonly [string, FileResult])[],
): Option.Option<typeof MetricsResultSchema.Type> =>
  Option.flatMap(
    Arr.head(entries),
    ([fileName, file]) =>
      Match.value(fileName === segment && entries.length === 1).pipe(
        Match.when(true, () => Option.some(fileResultOf(fileName, file))),
        Match.orElse(() => Option.none<typeof MetricsResultSchema.Type>()),
      ),
  )

const childResultOf = (
  segment: string,
  entries: readonly (readonly [string, FileResult])[],
): typeof MetricsResultSchema.Type =>
  Option.getOrElse(soleSegmentFileResult(segment, entries), () => nestedGroupResult(segment, entries))

const childResultsOf = (files: Readonly<Record<string, FileResult>>): readonly typeof MetricsResultSchema.Type[] =>
  Object.entries(groupBySegment(files))
    .map(([segment, grouped]) => childResultOf(segment, grouped))
    .sort((left, right) => left.name.localeCompare(right.name))

const metricsResultOf = (files: Readonly<Record<string, FileResult>>): typeof MetricsResultSchema.Type => ({
  name: 'All files',
  metrics: metricsOf(files),
  childResults: childResultsOf(files),
})

/**
 * One-way conversion of a report's file results into their aggregate metrics.
 * The inverse direction does not exist: counts cannot reconstruct the files
 * they were counted from.
 */
export const MetricsFromReport = FileResultDictionarySchema.pipe(
  S.decodeTo(Metrics, {
    decode: SGetter.transform((files) => metricsOf(files)),
    encode: SGetter.forbiddenEncoding,
  }),
)
export type MetricsFromReport = typeof MetricsFromReport.Type

/**
 * One-way conversion of a report's file results into the nested metrics tree
 * the reporters render. The inverse direction does not exist for the same
 * reason as `MetricsFromReport`.
 */
export const MetricsResultFromReport = FileResultDictionarySchema.pipe(
  S.decodeTo(MetricsResultSchema, {
    decode: SGetter.transform(metricsResultOf),
    encode: SGetter.forbiddenEncoding,
  }),
)
export type MetricsResultFromReport = typeof MetricsResultFromReport.Type
