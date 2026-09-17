import { Gherkin, Given, it, layer, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import { makeBuiltinReporterFactories } from '@systemfsoftware/stryker-js-engine/builtin-reporters'
import { calculateMetrics } from '@systemfsoftware/stryker-js-language'
import type { MetricsResult } from '@systemfsoftware/stryker-js-language'
import type { MutantResult, MutationTestResult } from '@systemfsoftware/stryker-js-language'
import {
  DryRunCompleted,
  MutantTested,
  MutationTestingPlanReady,
  MutationTestReportReady,
} from '@systemfsoftware/stryker-js-language'
import type { ReporterEvent } from '@systemfsoftware/stryker-js-language'
import { StrykerOptionsSchema } from '@systemfsoftware/stryker-js-language'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as Layer from 'effect/Layer'
import * as Path from 'effect/Path'
import * as S from 'effect/Schema'
import * as Sink from 'effect/Sink'
import * as Stdio from 'effect/Stdio'
import { expect } from 'vitest'

const Feature = makeFeature({ it, layer })

const MARKER_FILE = 'src/marker.ts'
const MARKER_TEST_FILE = 'src/marker.test.ts'

const captureSink = (chunks: string[]) =>
  Sink.forEach((chunk: string | Uint8Array) => Effect.sync(() => chunks.push(String(chunk))))

const options = (overrides: Record<string, unknown> = {}) => S.decodeUnknownSync(StrykerOptionsSchema)(overrides)

const writeThrough = (
  name: string,
  events: readonly ReporterEvent[],
): Effect.Effect<string, unknown, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*() {
    const chunks: string[] = []
    const stdio = yield* Stdio.Stdio.pipe(
      Effect.provide(Stdio.layerTest({ stdout: () => captureSink(chunks), stderr: () => captureSink(chunks) })),
    )
    const fileSystem = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const factory = makeBuiltinReporterFactories({ fileSystem, path, stdio })[name]
    if (factory === undefined) {
      throw new Error(`no builtin reporter answers to "${name}"`)
    }
    yield* factory(options(), {})(toStream(events))
    return chunks.join('')
  })

const reporterLayer = Layer.mergeAll(FileSystem.layerNoop({}), Path.layer)

const markerMutants = (status: 'Killed' | 'Survived'): readonly MutantResult[] => {
  const mutant: MutantResult = {
    id: '0',
    mutatorName: 'BooleanLiteral',
    replacement: 'false',
    status,
    location: { start: { line: 1, column: 24 }, end: { line: 1, column: 28 } },
    coveredBy: ['0'],
  }
  if (status === 'Killed') {
    return [{ ...mutant, killedBy: ['0'] }]
  }
  return [mutant]
}

const markerReport = (status: 'Killed' | 'Survived'): MutationTestResult => ({
  schemaVersion: '1.0',
  files: {
    [MARKER_FILE]: {
      language: 'typescript',
      source: 'export const marker = true',
      mutants: markerMutants(status),
    },
  },
  thresholds: { high: 80, low: 60 },
  testFiles: {
    [MARKER_TEST_FILE]: { tests: [{ id: '0', name: 'the marker is true' }] },
  },
})

const runEvents = (
  report: MutationTestResult,
  metrics: MetricsResult,
): readonly ReporterEvent[] => [
  DryRunCompleted.make({
    timing: { net: 1, overhead: 0 },
    capabilities: { reloadEnvironment: false },
    testCount: 1,
    tests: [],
  }),
  MutationTestingPlanReady.make({
    total: 1,
    plans: [{ mutantId: '0', plan: 'Run', netTime: 1, reloadEnvironment: false }],
  }),
  MutantTested.make({
    id: '0',
    status: 'Killed',
    file: MARKER_FILE,
    location: { start: { line: 1, column: 24 }, end: { line: 1, column: 28 } },
    mutator: 'BooleanLiteral',
    replacement: null,
    completed: 1,
    total: 1,
  }),
  MutationTestReportReady.make({ report, metrics }),
]

const toStream = (events: readonly ReporterEvent[]): AsyncIterable<ReporterEvent> => ({
  [Symbol.asyncIterator]: () => {
    const iterator = events[Symbol.iterator]()
    return {
      next: (...args: [] | [unknown]) => Promise.resolve(iterator.next(...args)),
    }
  },
})

const completedRun = (status: 'Killed' | 'Survived') => {
  const report = markerReport(status)
  return { report, metrics: calculateMetrics(report.files) }
}

const allFourEvents = (status: 'Killed' | 'Survived'): readonly ReporterEvent[] => {
  const run = completedRun(status)
  return runEvents(run.report, run.metrics)
}

Feature('Reporting a finished mutation run')
  .withScenarioLayer(reporterLayer)
  .body(({ scenario }) => {
    scenario(
      'A finished run names the file whose mutant survived',
      Gherkin.Do.pipe(
        Given('a completed run whose single mutant survived')('run', () => Effect.succeed(completedRun('Survived'))),
        When('the terminal report is written for the run')(
          'terminal',
          (s) => writeThrough('clear-text', runEvents(s.run.report, s.run.metrics)),
        ),
        Then('the score table names the mutated file')((s) => {
          expect(s.terminal).toContain('All files')
          expect(s.terminal).toContain(MARKER_FILE)
        }),
        Then('the surviving mutant is reported with its mutator')((s) => {
          expect(s.terminal).toContain('[Survived] BooleanLiteral')
        }),
      ),
    )

    scenario(
      'A finished run whose mutants all died reports a perfect score',
      Gherkin.Do.pipe(
        Given('a completed run whose single mutant was killed')('run', () => Effect.succeed(completedRun('Killed'))),
        When('the terminal report is written for the run')(
          'terminal',
          (s) => writeThrough('clear-text', runEvents(s.run.report, s.run.metrics)),
        ),
        Then('the score table reports a mutation score of 100.00')((s) => {
          expect(s.terminal).toContain('100.00')
        }),
      ),
    )

    scenario(
      'A run that stops before its report is ready prints nothing',
      Gherkin.Do.pipe(
        Given('a run that stopped after testing its mutants')(
          'events',
          () => Effect.succeed(allFourEvents('Killed').slice(0, 3)),
        ),
        When('the terminal report is written for the run')('terminal', (s) => writeThrough('clear-text', s.events)),
        Then('nothing is written to the terminal')((s) => {
          expect(s.terminal).toBe('')
        }),
      ),
    )

    scenario(
      'The progress bar fills as mutants finish and closes its line',
      Gherkin.Do.pipe(
        Given('a run whose single planned mutant finished')(
          'events',
          () => Effect.succeed(allFourEvents('Killed').slice(0, 3)),
        ),
        When('the progress report is written for the run')('terminal', (s) => writeThrough('progress', s.events)),
        Then('the bar counts the mutants it tested')((s) => {
          expect(s.terminal).toContain('Mutants tested')
        }),
        Then('the bar line is closed before the process continues')((s) => {
          expect(s.terminal.endsWith('\n')).toBe(true)
        }),
      ),
    )

    scenario(
      'The machine progress reporter leaves the terminal untouched',
      Gherkin.Do.pipe(
        Given('a run whose planned mutants finished')('events', () => Effect.succeed(allFourEvents('Killed'))),
        When('the machine progress report is written for the run')(
          'terminal',
          (s) => writeThrough('progress-stream', s.events),
        ),
        Then('nothing is written to the terminal')((s) => {
          expect(s.terminal).toBe('')
        }),
      ),
    )
  })
