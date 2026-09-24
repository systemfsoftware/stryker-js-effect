import {
  type FileResult,
  FileResultSchema,
  Metrics,
  type MetricsResult,
} from '@systemfsoftware/stryker-js-plugin-interface'
import type { MutantResult } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Arr from 'effect/Array'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as S from 'effect/Schema'

const segmentOf = (fileName: string): string =>
  Match.value(fileName.indexOf('/')).pipe(
    Match.when((separator) => separator < 0, () => fileName),
    Match.orElse((separator) => fileName.slice(0, separator)),
  )

type SegmentGroups = Readonly<Record<string, ReadonlyArray<readonly [string, FileResult]>>>

const groupBySegment = (files: Readonly<Record<string, FileResult>>): SegmentGroups =>
  Arr.groupBy(Object.entries(files), ([fileName]) => segmentOf(fileName))

const metricsOf = (files: Readonly<Record<string, FileResult>>): Metrics =>
  Metrics.fromMutants(Arr.flatMap(Object.values(files), (file) => file.mutants))

const fileResultOf = (fileName: string, file: FileResult): MetricsResult => ({
  name: fileName,
  metrics: Metrics.fromMutants(file.mutants),
  childResults: [],
})

const nestedGroupResult = (segment: string, entries: readonly (readonly [string, FileResult])[]): MetricsResult => {
  const nested = Object.fromEntries(entries.map(([fileName, file]) => [fileName.slice(segment.length + 1), file]))
  return { name: segment, metrics: metricsOf(nested), childResults: childResultsOf(nested) }
}

const soleSegmentFileResult = (
  segment: string,
  entries: readonly (readonly [string, FileResult])[],
): Option.Option<MetricsResult> =>
  Option.flatMap(
    Arr.head(entries),
    ([fileName, file]) =>
      Match.value(fileName === segment && entries.length === 1).pipe(
        Match.when(true, () => Option.some(fileResultOf(fileName, file))),
        Match.orElse(() => Option.none<MetricsResult>()),
      ),
  )

const childResultOf = (segment: string, entries: readonly (readonly [string, FileResult])[]): MetricsResult =>
  Option.getOrElse(soleSegmentFileResult(segment, entries), () => nestedGroupResult(segment, entries))

const childResultsOf = (files: Readonly<Record<string, FileResult>>): readonly MetricsResult[] =>
  Object.entries(groupBySegment(files))
    .map(([segment, grouped]): MetricsResult => childResultOf(segment, grouped))
    .sort((left, right) => left.name.localeCompare(right.name))

export class CalculateMetrics extends S.TaggedClass<CalculateMetrics>()('CalculateMetrics', {
  files: S.Record(S.String, FileResultSchema),
}) {
  static readonly of = (files: Readonly<Record<string, FileResult>>): MetricsResult => ({
    name: 'All files',
    metrics: metricsOf(files),
    childResults: childResultsOf(files),
  })

  static readonly count = (mutants: readonly MutantResult[]): Metrics => Metrics.fromMutants(mutants)
}
