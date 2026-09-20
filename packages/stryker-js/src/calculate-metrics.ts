import type { FileResult, MetricsResult, MutantResult } from '@systemfsoftware/stryker-js-plugin-interface'
import { Metrics } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Arr from 'effect/Array'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'

export const countMutants = (mutants: readonly MutantResult[]): Metrics => Metrics.fromMutants(mutants)

const segmentOf = (fileName: string): string => {
  const separator = fileName.indexOf('/')
  if (separator === -1) {
    return fileName
  }
  return fileName.slice(0, separator)
}

const groupBySegment = (
  files: Readonly<Record<string, FileResult>>,
): Readonly<Record<string, Readonly<Record<string, FileResult>>>> =>
  Object.entries(files).reduce<Record<string, Record<string, FileResult>>>((groups, [fileName, file]) => {
    const segment = segmentOf(fileName)
    const current = groups[segment] ?? {}
    return {
      ...groups,
      [segment]: { ...current, [fileName]: file },
    }
  }, {})

const metricsOf = (files: Readonly<Record<string, FileResult>>): Metrics =>
  countMutants(Object.values(files).flatMap((file) => file.mutants))

const fileResultOf = (fileName: string, file: FileResult): MetricsResult => ({
  name: fileName,
  metrics: countMutants(file.mutants),
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
    .map(([segment, grouped]): MetricsResult => childResultOf(segment, Object.entries(grouped)))
    .sort((left, right) => left.name.localeCompare(right.name))

export const calculateMetrics = (files: Readonly<Record<string, FileResult>>): MetricsResult => ({
  name: 'All files',
  metrics: metricsOf(files),
  childResults: childResultsOf(files),
})
