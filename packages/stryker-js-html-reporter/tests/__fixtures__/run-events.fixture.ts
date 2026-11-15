import { Mutant, Options, Report, Reporter } from '@systemfsoftware/stryker-js-plugin-interface'
import * as S from 'effect/Schema'

export const MARKER = 'html-factory-pin-7d2c'

export const optionsWith = (fileName: string) =>
  S.decodeEffect(Options.StrykerOptionsSchema)({ htmlReporter: { fileName } })

export const reportFixture = (): Report.MutationTestResult => ({
  schemaVersion: '1.0',
  files: {
    'src/marker.ts': {
      language: 'typescript',
      source: `export const marker = '${MARKER}'`,
      mutants: [
        {
          id: Mutant.MutantId.make('0000000000000000'),
          mutatorName: 'BlockStatement',
          status: 'Killed',
          location: { start: { line: 1, column: 1 }, end: { line: 1, column: 11 } },
        },
      ],
    },
  },
  thresholds: { high: 80, low: 60, break: null },
})

export const metricsFixture = (): Report.MetricsResult => ({
  name: 'All files',
  metrics: Report.metricsFromMutants([{ status: 'Killed' }]),
  childResults: [],
})

export const runEvents = (
  { report, metrics }: { readonly report: Report.MutationTestResult; readonly metrics: Report.MetricsResult },
): readonly Reporter.ReporterEvent[] => [
  Reporter.DryRunCompleted.make({
    timing: { net: 1, overhead: 0 },
    capabilities: { reloadEnvironment: false },
    testCount: 0,
    tests: [],
  }),
  Reporter.MutationTestingPlanReady.make({
    total: 1,
    plans: [{ mutantId: Mutant.MutantId.make('0000000000000000'), plan: 'Run', netTime: 1, reloadEnvironment: false }],
  }),
  Reporter.MutantTested.make({
    id: Mutant.MutantId.make('0000000000000000'),
    status: 'Killed',
    fileName: Mutant.CanonicalFileName.make('src/marker.ts'),
    location: { start: { line: 1, column: 1 }, end: { line: 1, column: 11 } },
    mutatorName: Mutant.MutatorName.make('BlockStatement'),
    replacement: null,
    completed: 1,
    total: 1,
  }),
  Reporter.MutationTestReportReady.make({ report, metrics }),
]

export function toStream(events: readonly Reporter.ReporterEvent[]): AsyncIterable<Reporter.ReporterEvent> {
  let index = 0
  return {
    [Symbol.asyncIterator](): AsyncIterator<Reporter.ReporterEvent> {
      return {
        next(): Promise<IteratorResult<Reporter.ReporterEvent>> {
          const value: Reporter.ReporterEvent | undefined = events[index]
          index += 1
          if (value !== undefined) {
            return Promise.resolve({ value, done: false })
          }
          const done: IteratorResult<Reporter.ReporterEvent> = { done: true, value: undefined }
          return Promise.resolve(done)
        },
      }
    },
  }
}
