import { describe, it } from '@effect/vitest'
import { Report } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Arr from 'effect/Array'
import * as Option from 'effect/Option'

import { MetricsResultFromReport } from '../reporting/metrics-from-report.schema.js'

type Files = Readonly<Record<string, Report.FileResult>>

const inputMutantCountOf = (files: Files) =>
  Object.values(files).reduce((total, file) => total + file.mutants.length, 0)

const partitionsCountsOverChildren = (tree: typeof Report.MetricsResultSchema.Type): boolean => {
  const partitions =
    tree.metrics.totalMutants === tree.childResults.reduce((total, child) => total + child.metrics.totalMutants, 0)
  return (tree.childResults.length === 0 || partitions) && tree.childResults.every(partitionsCountsOverChildren)
}

const everyLevelSorted = (tree: typeof Report.MetricsResultSchema.Type): boolean => {
  const names = tree.childResults.map((child) => child.name)
  return names.every((name, index) =>
    Option.match(Arr.get(names, index - 1), {
      onNone: () => true,
      onSome: (previous) => previous.localeCompare(name) <= 0,
    })
  ) &&
    tree.childResults.every(everyLevelSorted)
}

describe('metrics-from-report', () => {
  it.prop(
    '∀files_MetricsResultFromReport_ConservesMutantCountAtRoot',
    [Report.FileResultDictionarySchema],
    ([files]) => {
      const tree = MetricsResultFromReport.fromFiles(files)
      return tree.metrics.totalMutants === inputMutantCountOf(files)
    },
  )

  it.prop(
    '∀files_MetricsResultFromReport_PartitionsCountsOverChildren',
    [Report.FileResultDictionarySchema],
    ([files]) => partitionsCountsOverChildren(MetricsResultFromReport.fromFiles(files)),
  )

  it.prop(
    '∀files_MetricsResultFromReport_SortsChildResultsByLocale',
    [Report.FileResultDictionarySchema],
    ([files]) => everyLevelSorted(MetricsResultFromReport.fromFiles(files)),
  )
})
