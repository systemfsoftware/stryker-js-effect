/// <reference types="vitest/importMeta" />
import { Report } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Arr from 'effect/Array'
import * as Match from 'effect/Match'
import * as S from 'effect/Schema'

type Files = Readonly<Record<string, Report.FileResult>>
type Entries = ReadonlyArray<readonly [string, Report.FileResult]>

const segmentOf = (fileName: string): string =>
  Match.value(fileName.indexOf('/')).pipe(
    Match.when((separator) => separator < 0, () => fileName),
    Match.orElse((separator) => fileName.slice(0, separator)),
  )

const groupBySegment = (entries: Entries) => Arr.groupBy(entries, ([fileName]) => segmentOf(fileName))

const metricsOf = (entries: Entries) => Report.Metrics.fromMutants(Arr.flatMap(entries, ([, file]) => file.mutants))

const fileResultOf = (fileName: string, file: Report.FileResult) =>
  MetricsResultFromReport.make({ name: fileName, metrics: Report.Metrics.fromMutants(file.mutants), childResults: [] })

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

export class MetricsResultFromReport extends S.Class<MetricsResultFromReport, Report.MetricsResultEncoded>(
  'MetricsResultFromReport',
)({
  name: S.String,
  metrics: Report.Metrics,
  childResults: S.Array(
    S.suspend((): S.Codec<Report.MetricsResult, Report.MetricsResultEncoded> => MetricsResultFromReport),
  ),
}) {
  static readonly fromFiles = (files: Files) => metricsResultOf(Object.entries(files))
}

const metricsResultOf = (entries: Entries) =>
  MetricsResultFromReport.make({
    name: 'All files',
    metrics: metricsOf(entries),
    childResults: childResultsOf(entries),
  })

if (import.meta.vitest !== void 0) {
  const { it } = await import('@systemfsoftware/vitest')

  const inputMutantCountOf = (files: Files) =>
    Object.values(files).reduce((total, file) => total + file.mutants.length, 0)

  const childTotalOf = (tree: Report.MetricsResult): number =>
    tree.childResults.reduce((total, child) => total + child.metrics.totalMutants, 0)

  const countsArePartitioned = (tree: Report.MetricsResult): boolean =>
    tree.childResults.length === 0 || tree.metrics.totalMutants === childTotalOf(tree)

  const everyChildPartitions = (tree: Report.MetricsResult): boolean =>
    tree.childResults.every(partitionsCountsOverChildren)

  const partitionsCountsOverChildren = (tree: Report.MetricsResult): boolean =>
    countsArePartitioned(tree) && everyChildPartitions(tree)

  const previousNameOf = (names: ReadonlyArray<string>, index: number): string => names[index - 1] ?? ''

  const nameAt = (names: ReadonlyArray<string>, index: number): string => names[index] ?? ''

  const isOrderedPair = (previous: string, name: string): boolean => previous.localeCompare(name) <= 0

  const isOrderedFrom = (names: ReadonlyArray<string>, index: number): boolean =>
    index === 0 || isOrderedPair(previousNameOf(names, index), nameAt(names, index))

  const namesAreSorted = (names: ReadonlyArray<string>): boolean =>
    names.every((_, index) => isOrderedFrom(names, index))

  const childrenAreSorted = (tree: Report.MetricsResult): boolean => tree.childResults.every(everyLevelSorted)

  const everyLevelSorted = (tree: Report.MetricsResult): boolean =>
    namesAreSorted(tree.childResults.map((child) => child.name)) && childrenAreSorted(tree)

  const topSegmentsOf = (files: Files): ReadonlySet<string> => new Set(Object.keys(files).map(segmentOf))

  const childNamesAreTopSegments = (tree: Report.MetricsResult, files: Files): boolean => {
    const segments = topSegmentsOf(files)
    return tree.childResults.every((child) => segments.has(segmentOf(child.name)))
  }

  it.prop(
    '∀files_MetricsResultFromReport_≡ConservesMutantCountAtRoot',
    { of: [Report.FileResultDictionarySchema], subject: MetricsResultFromReport.fromFiles },
    (subject, [files]) => subject(files).metrics.totalMutants === inputMutantCountOf(files),
  )

  it.prop(
    '∀files_MetricsResultFromReport_≡PartitionsCountsOverChildren',
    { of: [Report.FileResultDictionarySchema], subject: MetricsResultFromReport.fromFiles },
    (subject, [files]) => partitionsCountsOverChildren(subject(files)),
  )

  it.prop(
    '∀files_MetricsResultFromReport_≡SortsChildResultsByLocale',
    { of: [Report.FileResultDictionarySchema], subject: MetricsResultFromReport.fromFiles },
    (subject, [files]) => everyLevelSorted(subject(files)),
  )

  it.prop(
    '∀files_Children_≡TopSegmentsOfTheInput',
    { of: [Report.FileResultDictionarySchema], subject: MetricsResultFromReport.fromFiles },
    (subject, [files]) => childNamesAreTopSegments(subject(files), files),
  )
}
