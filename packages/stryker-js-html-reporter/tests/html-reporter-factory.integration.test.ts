import * as NodeFileSystem from '@effect/platform-node-shared/NodeFileSystem'
import * as NodePath from '@effect/platform-node-shared/NodePath'
import { Gherkin, Given, it, layer, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import { makeHtmlReporter } from '@systemfsoftware/stryker-js-html-reporter'
import type { MetricsResult } from '@systemfsoftware/stryker-js-language'
import type * as reportApi from '@systemfsoftware/stryker-js-language'
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
import { expect } from 'vitest'

const Feature = makeFeature({ it, layer })

const MARKER = 'html-factory-pin-7d2c'

const nodeFsPathLayer = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer)

const runNode = <A, E>(
  effect: Effect.Effect<A, E, FileSystem.FileSystem | Path.Path>,
): Promise<A> => Effect.runPromise(Effect.provide(effect, nodeFsPathLayer))

const makeTempDir = (prefix: string): Promise<string> =>
  runNode(
    Effect.gen(function*() {
      const fs = yield* FileSystem.FileSystem
      return yield* fs.makeTempDirectory({ prefix })
    }),
  )

const joinPath = (...parts: ReadonlyArray<string>): Promise<string> =>
  runNode(
    Effect.gen(function*() {
      const path = yield* Path.Path
      return path.join(...parts)
    }),
  )

const writeText = (file: string, content: string): Promise<void> =>
  runNode(
    Effect.gen(function*() {
      const fs = yield* FileSystem.FileSystem
      yield* fs.writeFileString(file, content)
    }),
  )

const readText = (file: string): Promise<string> =>
  runNode(
    Effect.gen(function*() {
      const fs = yield* FileSystem.FileSystem
      return yield* fs.readFileString(file)
    }),
  )

const fileExists = (file: string): Promise<boolean> =>
  runNode(
    Effect.gen(function*() {
      const fs = yield* FileSystem.FileSystem
      return yield* fs.exists(file)
    }),
  )

const removeDir = (dir: string): Promise<void> =>
  runNode(
    Effect.gen(function*() {
      const fs = yield* FileSystem.FileSystem
      yield* fs.remove(dir, { recursive: true })
    }),
  )

const optionsWith = (fileName: string) => S.decodeSync(StrykerOptionsSchema)({ htmlReporter: { fileName } })

const reportFixture = (): reportApi.MutationTestResult => ({
  schemaVersion: '1.0',
  files: {
    'src/marker.ts': {
      language: 'typescript',
      source: `export const marker = '${MARKER}'`,
      mutants: [
        {
          id: '0',
          mutatorName: 'BlockStatement',
          status: 'Killed',
          location: { start: { line: 1, column: 0 }, end: { line: 1, column: 10 } },
        },
      ],
    },
  },
  thresholds: { high: 80, low: 60 },
})

const metricsFixture = (): MetricsResult => ({
  name: 'All files',
  metrics: {
    pending: 0,
    killed: 1,
    timeout: 0,
    survived: 0,
    noCoverage: 0,
    runtimeErrors: 0,
    compileErrors: 0,
    ignored: 0,
    totalDetected: 1,
    totalUndetected: 0,
    totalInvalid: 0,
    totalValid: 1,
    totalMutants: 1,
    totalCovered: 1,
    mutationScore: 100,
    mutationScoreBasedOnCoveredCode: 100,
  },
  childResults: [],
})

const runEvents = (
  report: reportApi.MutationTestResult,
  metrics: MetricsResult,
): readonly ReporterEvent[] => [
  DryRunCompleted.make({
    timing: { net: 1, overhead: 0 },
    capabilities: { reloadEnvironment: false },
    testCount: 0,
    tests: [],
  }),
  MutationTestingPlanReady.make({
    total: 1,
    plans: [{ mutantId: '0', plan: 'Run', netTime: 1, reloadEnvironment: false }],
  }),
  MutantTested.make({
    id: '0',
    status: 'Killed',
    file: 'src/marker.ts',
    location: { start: { line: 1, column: 0 }, end: { line: 1, column: 10 } },
    mutator: 'BlockStatement',
    replacement: null,
    completed: 1,
    total: 1,
  }),
  MutationTestReportReady.make({ report, metrics }),
]

function toStream(events: readonly ReporterEvent[]): AsyncIterable<ReporterEvent> {
  let index = 0
  return {
    [Symbol.asyncIterator](): AsyncIterator<ReporterEvent> {
      return {
        next(): Promise<IteratorResult<ReporterEvent>> {
          const value: ReporterEvent | undefined = events[index]
          index += 1
          if (value !== undefined) {
            return Promise.resolve({ value, done: false })
          }
          const done: IteratorResult<ReporterEvent> = { done: true, value: undefined }
          return Promise.resolve(done)
        },
      }
    },
  }
}

Feature('Writing the html mutation report').body(({ scenario }) => {
  scenario(
    'A completed run writes a self-contained report',
    Gherkin.Do.pipe(
      Given('an output directory beside an unrelated bundle file')('output', () =>
        Effect.gen(function*() {
          const dir = yield* Effect.promise(() => makeTempDir('html-factory-pin-'))
          const fileName = yield* Effect.promise(() => joinPath(dir, 'index.html'))
          const decoy = yield* Effect.promise(() => joinPath(dir, 'mutation-test-elements.js'))
          yield* Effect.promise(() => writeText(decoy, 'DECOY-BUNDLE'))
          return { dir, fileName }
        })),
      When('the reporter consumes a completed run')('html', (s) =>
        Effect.gen(function*() {
          try {
            const consume = makeHtmlReporter(optionsWith(s.output.fileName), {})
            yield* Effect.promise(() => consume(toStream(runEvents(reportFixture(), metricsFixture()))))
            return yield* Effect.promise(() => readText(s.output.fileName))
          } finally {
            yield* Effect.promise(() => removeDir(s.output.dir))
          }
        })),
      Then('the written document embeds the run result')((s) => {
        expect(s.html).toContain(MARKER)
        expect(s.html).toContain('mutation-test-report-app')
      }),
      Then('the document carries its own bundle, not the neighbouring file or a host path')((s) => {
        expect(s.html).not.toContain('DECOY-BUNDLE')
        expect(s.html).not.toContain(s.output.dir)
      }),
    ),
  )

  scenario(
    'The same run writes the same document twice',
    Gherkin.Do.pipe(
      Given('a completed run')('run', () =>
        Effect.succeed({
          report: reportFixture(),
          metrics: metricsFixture(),
        })),
      When('the reporter writes the same run into two directories')('documents', (s) =>
        Effect.gen(function*() {
          const dirA = yield* Effect.promise(() => makeTempDir('html-purity-a-'))
          const dirB = yield* Effect.promise(() => makeTempDir('html-purity-b-'))
          try {
            const fileA = yield* Effect.promise(() => joinPath(dirA, 'index.html'))
            const fileB = yield* Effect.promise(() => joinPath(dirB, 'index.html'))
            yield* Effect.promise(() =>
              makeHtmlReporter(optionsWith(fileA), {})(toStream(runEvents(s.run.report, s.run.metrics)))
            )
            yield* Effect.promise(() =>
              makeHtmlReporter(optionsWith(fileB), {})(toStream(runEvents(s.run.report, s.run.metrics)))
            )
            const existed = yield* Effect.promise(() => fileExists(fileA))
            return {
              a: yield* Effect.promise(() => readText(fileA)),
              b: yield* Effect.promise(() => readText(fileB)),
              existed,
            }
          } finally {
            yield* Effect.promise(() => removeDir(dirA))
            yield* Effect.promise(() => removeDir(dirB))
          }
        })),
      Then('a report is written')((s) => {
        expect(s.documents.existed).toBe(true)
      }),
      Then('both documents are identical')((s) => {
        expect(s.documents.a).toBe(s.documents.b)
      }),
    ),
  )
})
