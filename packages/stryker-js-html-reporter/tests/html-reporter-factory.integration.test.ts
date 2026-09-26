import * as NodeFileSystem from '@effect/platform-node-shared/NodeFileSystem'
import * as NodePath from '@effect/platform-node-shared/NodePath'
import { Gherkin, Given, it, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import { HtmlReporter } from '@systemfsoftware/stryker-js-html-reporter'
import { Mutant } from '@systemfsoftware/stryker-js-instrumenter'
import { Options, Report, Reporter } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as Layer from 'effect/Layer'
import * as Path from 'effect/Path'
import * as S from 'effect/Schema'

const Feature = makeFeature({ it })

const MARKER = 'html-factory-pin-7d2c'

const nodeFsPathLayer = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer)

const runNode = <A, E>(
  effect: Effect.Effect<A, E, FileSystem.FileSystem | Path.Path>,
): Promise<A> =>
  nodeFsPathLayer.pipe(
    Layer.build,
    Effect.flatMap((platformServices) => Effect.provideContext(effect, platformServices)),
    Effect.scoped,
    Effect.runPromise,
  )

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

const optionsWith = (fileName: string) => S.decodeEffect(Options.StrykerOptionsSchema)({ htmlReporter: { fileName } })

const reportFixture = (): Report.MutationTestResult => ({
  schemaVersion: '1.0',
  files: {
    'src/marker.ts': {
      language: 'typescript',
      source: `export const marker = '${MARKER}'`,
      mutants: [
        {
          id: Mutant.MutantId.make('0'),
          mutatorName: 'BlockStatement',
          status: 'Killed',
          location: { start: { line: 1, column: 1 }, end: { line: 1, column: 11 } },
        },
      ],
    },
  },
  thresholds: { high: 80, low: 60, break: null },
})

const metricsFixture = (): Report.MetricsResult => ({
  name: 'All files',
  metrics: Report.metricsFromMutants([{ status: 'Killed' }]),
  childResults: [],
})

const runEvents = (
  report: Report.MutationTestResult,
  metrics: Report.MetricsResult,
): readonly Reporter.ReporterEvent[] => [
  Reporter.DryRunCompleted.make({
    timing: { net: 1, overhead: 0 },
    capabilities: { reloadEnvironment: false },
    testCount: 0,
    tests: [],
  }),
  Reporter.MutationTestingPlanReady.make({
    total: 1,
    plans: [{ mutantId: Mutant.MutantId.make('0'), plan: 'Run', netTime: 1, reloadEnvironment: false }],
  }),
  Reporter.MutantTested.make({
    id: Mutant.MutantId.make('0'),
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

function toStream(events: readonly Reporter.ReporterEvent[]): AsyncIterable<Reporter.ReporterEvent> {
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

Feature('Writing the html mutation report').withLayer(nodeFsPathLayer).body(({ scenario }) => {
  scenario(
    'A completed run writes a self-contained report',
    { live: 'the scenario creates a real temporary directory and reads real files' },
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
            const options = yield* optionsWith(s.output.fileName)
            const consume = HtmlReporter.makeHtmlReporter(options, {})
            yield* consume(toStream(runEvents(reportFixture(), metricsFixture())))
            return yield* Effect.promise(() => readText(s.output.fileName))
          } finally {
            yield* Effect.promise(() => removeDir(s.output.dir))
          }
        })),
      Then('the written document embeds the run result and its own bundle, not the neighbouring file or a host path')((
        s,
        expect,
      ) =>
        expect({
          marker: s.html.includes(MARKER),
          app: s.html.includes('mutation-test-report-app'),
          decoy: s.html.includes('DECOY-BUNDLE'),
          hostPath: s.html.includes(s.output.dir),
        }).toEqual({ marker: true, app: true, decoy: false, hostPath: false })
      ),
    ),
  )

  scenario(
    'The same run writes the same document twice',
    { live: 'the scenario creates real temporary directories and reads real files' },
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
            const optionsA = yield* optionsWith(fileA)
            const optionsB = yield* optionsWith(fileB)
            yield* HtmlReporter.makeHtmlReporter(optionsA, {})(toStream(runEvents(s.run.report, s.run.metrics)))
            yield* HtmlReporter.makeHtmlReporter(optionsB, {})(toStream(runEvents(s.run.report, s.run.metrics)))
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
      Then('a report is written and both documents are identical')((s, expect) =>
        expect({ existed: s.documents.existed, b: s.documents.b }).toEqual({ existed: true, b: s.documents.a })
      ),
    ),
  )
})
