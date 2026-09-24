import { describe, it } from '@effect/vitest'
import { FileResultDictionarySchema, MetricsResultSchema } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Arr from 'effect/Array'
import * as S from 'effect/Schema'

import { MetricsResultFromReport } from '../reporting/metrics-from-report.schema.js'

const treeEquals = S.toEquivalence(MetricsResultSchema)

type Files = Readonly<Record<string, { readonly mutants: ReadonlyArray<unknown> }>>

const inputMutantCountOf = (files: Files) =>
  Object.values(files).reduce((total, file) => total + file.mutants.length, 0)

const partitionsCountsOverChildren = (tree: typeof MetricsResultSchema.Type): boolean =>
  tree.metrics.totalMutants === Arr.sum(Arr.map(tree.childResults, (child) => child.metrics.totalMutants)) &&
  tree.childResults.every(partitionsCountsOverChildren)

const everyLevelSorted = (tree: typeof MetricsResultSchema.Type): boolean =>
  Arr.isSortedWith(tree.childResults, (left, right) => left.name.localeCompare(right.name)) &&
  tree.childResults.every(everyLevelSorted)

describe('metrics-from-report', () => {
  it.prop('∀files_MetricsResultFromReport_ConservesMutantCountAtRoot', [FileResultDictionarySchema], ([files]) => {
    const tree = MetricsResultFromReport.fromFiles(files)
    return tree.metrics.totalMutants === inputMutantCountOf(files)
  })

  it.prop('∀files_MetricsResultFromReport_PartitionsCountsOverChildren', [FileResultDictionarySchema], ([files]) =>
    partitionsCountsOverChildren(MetricsResultFromReport.fromFiles(files)))

  it.prop('∀files_MetricsResultFromReport_SortsChildResultsByLocale', [FileResultDictionarySchema], ([files]) =>
    everyLevelSorted(MetricsResultFromReport.fromFiles(files)))
})