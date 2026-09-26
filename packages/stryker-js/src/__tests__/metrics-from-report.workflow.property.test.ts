import { Report } from '@systemfsoftware/stryker-js-plugin-interface'
import { describe, it } from '@systemfsoftware/vitest'

import { metricsResultFromFiles } from '../reporting/metrics-from-report.js'

type Files = Readonly<Record<string, Report.FileResult>>

const inputMutantCountOf = (files: Files): number =>
  Object.values(files).reduce((total, file) => total + file.mutants.length, 0)

const childTotalOf = (tree: Report.MetricsResult): number =>
  tree.childResults.reduce((total, child) => total + child.metrics.totalMutants, 0)

const countsArePartitioned = (tree: Report.MetricsResult): boolean =>
  tree.childResults.length === 0 || tree.metrics.totalMutants === childTotalOf(tree)

const everyLevelPartitions = (tree: Report.MetricsResult): boolean =>
  countsArePartitioned(tree) && tree.childResults.every(everyLevelPartitions)

const namesAreSorted = (names: ReadonlyArray<string>): boolean =>
  names.every((name, index) => index === 0 || (names[index - 1] ?? '').localeCompare(name) <= 0)

const everyLevelSorted = (tree: Report.MetricsResult): boolean =>
  namesAreSorted(tree.childResults.map((child) => child.name)) && tree.childResults.every(everyLevelSorted)

const segmentOf = (fileName: string): string => fileName.split('/')[0] ?? fileName

const childNamesAreTopSegments = (tree: Report.MetricsResult, files: Files): boolean => {
  const segments = new Set(Object.keys(files).map(segmentOf))
  return tree.childResults.every((child) => segments.has(segmentOf(child.name)))
}

describe('metricsResultFromFiles', () => {
  it.prop(
    '∀files_MetricsResultFromFiles_≡ConservesMutantCountAtRoot',
    { of: [Report.FileResultDictionarySchema], subject: metricsResultFromFiles },
    (subject, [files]) => subject(files).metrics.totalMutants === inputMutantCountOf(files),
  )

  it.prop(
    '∀files_MetricsResultFromFiles_≡PartitionsCountsOverChildren',
    { of: [Report.FileResultDictionarySchema], subject: metricsResultFromFiles },
    (subject, [files]) => everyLevelPartitions(subject(files)),
  )

  it.prop(
    '∀files_MetricsResultFromFiles_≡SortsChildResultsByLocale',
    { of: [Report.FileResultDictionarySchema], subject: metricsResultFromFiles },
    (subject, [files]) => everyLevelSorted(subject(files)),
  )

  it.prop(
    '∀files_Children_≡TopSegmentsOfTheInput',
    { of: [Report.FileResultDictionarySchema], subject: metricsResultFromFiles },
    (subject, [files]) => childNamesAreTopSegments(subject(files), files),
  )
})
