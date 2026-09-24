import { pathToFileURL } from 'node:url'

import { it } from '@effect/vitest'
import { FileResultDictionarySchema } from '@systemfsoftware/stryker-js-plugin-interface'
import { describe } from 'vitest'

import { MetricsResultFromReport } from '../reporting/metrics-from-report.schema.js'

const BASELINE_CALCULATE_METRICS = '/tmp/refactor/baseline/packages/stryker-js/src/calculate-metrics.ts'
const baseline: { calculateMetrics: (files: unknown) => object } = await import(
  pathToFileURL(BASELINE_CALCULATE_METRICS).href
)

const sampleFiles: ReadonlyArray<Record<string, unknown>> = [
  {},
  {
    'a.ts': {
      language: 'typescript',
      source: 'const a = 1',
      mutants: [{ id: '0', mutatorName: 'BooleanLiteral', replacement: 'false', status: 'Killed', location: {
        start: { line: 1, column: 0 },
        end: { line: 1, column: 8 },
      } }],
    },
  },
  {
    'src/x.ts': { language: 'typescript', source: '', mutants: [] },
    'src/deep/y.ts': {
      language: 'typescript',
      source: '',
      mutants: [{ id: '1', mutatorName: 'StringLiteral', replacement: '""', status: 'Survived', location: {
        start: { line: 2, column: 1 },
        end: { line: 2, column: 9 },
      } }],
    },
  },
]

describe('metrics old-vs-new (throwaway baseline evidence)', () => {
  it.prop('∀files_NewMetricsTree_≡BaselineCalculateMetrics', [FileResultDictionarySchema], ([files]) => {
    const next = JSON.stringify(MetricsResultFromReport.fromFiles(files))
    let previous: string
    try {
      previous = JSON.stringify(baseline.calculateMetrics(files))
    } catch {
      return true
    }
    return next === previous
  })

  it('captures old and new JSON for fixed samples', () => {
    const captures = sampleFiles.map((files) => ({
      new: JSON.stringify(MetricsResultFromReport.fromFiles(files)),
      previous: JSON.stringify(baseline.calculateMetrics(files)),
    }))
    const mismatched = captures.filter((capture) => capture.new !== capture.previous)
    if (mismatched.length > 0) {
      throw new Error(`old-vs-new mismatch: ${JSON.stringify(mismatched)}`)
    }
  })
})