import {
  type FileResult,
  type MetricsResult,
  type MetricsResultEncoded,
  Metrics,
} from '@systemfsoftware/stryker-js-plugin-interface'
import * as Arr from 'effect/Array'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as S from 'effect/Schema'

type Files = Readonly<Record<string, FileResult>>
type SegmentGroups = Readonly<Record<string, ReadonlyArray<readonly [string, FileResult]>>>

const segmentOf = (fileName: string): string =>
  Match.value(fileName.indexOf('/')).pipe(
    Match.when((separator) => separator < 0, () => fileName),
    Match.orElse((separator) => fileName.slice(0, separator)),
  )

const groupBySegment = (files: Files): SegmentGroups =>
  Arr.groupBy(Object.entries(files), ([fileName]) => segmentOf(fileName))

const metricsOf = (files: Files) => Metrics.fromMutants(Arr.flatMap(Object.values(files), (file) => file.mutants))

const fileResultOf = (fileName: string, file: FileResult) =>
  MetricsResultFromReport.make({ name: fileName, metrics: Metrics.fromMutants(file.mutants), childResults: [] })

const nestedGroupResult = (segment: string, entries: readonly (readonly [string, FileResult])[]) => {
  const nested = Object.fromEntries(entries.map(([fileName, file]) => [fileName.slice(segment.length + 1), file]))
  return MetricsResultFromReport.make({
    name: segment,
    metrics: metricsOf(nested),
    childResults: childResultsOf(nested),
  })
}

const soleSegmentFileResult = (segment: string, entries: readonly (readonly [string, FileResult])[]) =>
  Option.flatMap(
    Arr.head(entries),
    ([fileName, file]) =>
      Match.value(fileName === segment && entries.length === 1).pipe(
        Match.when(true, () => Option.some(fileResultOf(fileName, file))),
        Match.orElse(() => Option.none<MetricsResult>()),
      ),
  )

const childResultOf = (segment: string, entries: readonly (readonly [string, Files[keyof Files]])[]) =>
  Option.getOrElse(soleSegmentFileResult(segment, entries), () => nestedGroupResult(segment, entries))

const childResultsOf = (files: Files): ReadonlyArray<MetricsResult> =>
  Object.entries(groupBySegment(files))
    .map(([segment, grouped]) => childResultOf(segment, grouped))
    .sort((left, right) => left.name.localeCompare(right.name))

export class MetricsResultFromReport extends S.Class<MetricsResultFromReport, MetricsResultEncoded>(
  'MetricsResultFromReport',
)({
  name: S.String,
  metrics: Metrics,
  childResults: S.Array(S.suspend((): S.Codec<MetricsResult, MetricsResultEncoded> => MetricsResultFromReport)),
}) {
  static readonly fromFiles = (files: Files) => metricsResultOf(files)
}

const metricsResultOf = (files: Files) =>
  MetricsResultFromReport.make({
    name: 'All files',
    metrics: metricsOf(files),
    childResults: childResultsOf(files),
  })
