import { Report } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Arr from 'effect/Array'
import * as Match from 'effect/Match'

import { MetricsResultFromReport } from './metrics-from-report.schema.js'

type Files = Readonly<Record<string, Report.FileResult>>
type Entries = ReadonlyArray<readonly [string, Report.FileResult]>

const segmentOf = (fileName: string): string =>
  Match.value(fileName.indexOf('/')).pipe(
    Match.when((separator) => separator < 0, () => fileName),
    Match.orElse((separator) => fileName.slice(0, separator)),
  )

const groupBySegment = (entries: Entries) => Arr.groupBy(entries, ([fileName]) => segmentOf(fileName))

const metricsOf = (entries: Entries) => Report.metricsFromMutants(Arr.flatMap(entries, ([, file]) => file.mutants))

const fileResultOf = (fileName: string, file: Report.FileResult) =>
  MetricsResultFromReport.make({ name: fileName, metrics: Report.metricsFromMutants(file.mutants), childResults: [] })

const nestedGroupResult = (segment: string, entries: Entries) => {
  const nested = entries.map(([fileName, file]) => [fileName.slice(segment.length + 1), file] as const)
  return MetricsResultFromReport.make({
    name: segment,
    metrics: metricsOf(nested),
    childResults: childResultsOf(nested),
  })
}

const groupResultsOf = (segment: string, entries: Entries): ReadonlyArray<Report.MetricsResult> =>
  Match.value(entries.every(([fileName]) => fileName === segment)).pipe(
    Match.when(true, () => entries.map(([fileName, file]) => fileResultOf(fileName, file))),
    Match.orElse(() => [nestedGroupResult(segment, entries)]),
  )

const childResultsOf = (entries: Entries): ReadonlyArray<Report.MetricsResult> =>
  Object.entries(groupBySegment(entries))
    .flatMap(([segment, grouped]) => groupResultsOf(segment, grouped))
    .sort((left, right) => left.name.localeCompare(right.name))

export const metricsResultFromFiles = (files: Files): MetricsResultFromReport =>
  MetricsResultFromReport.make({
    name: 'All files',
    metrics: metricsOf(Object.entries(files)),
    childResults: childResultsOf(Object.entries(files)),
  })
