import * as NodeFileSystem from '@effect/platform-node-shared/NodeFileSystem'
import * as NodePath from '@effect/platform-node-shared/NodePath'
import { Gherkin, Given, it, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import { HtmlReporter } from '@systemfsoftware/stryker-js-html-reporter'
import { Options, Report, Reporter } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as Layer from 'effect/Layer'
import * as Path from 'effect/Path'
import * as S from 'effect/Schema'

const Feature = makeFeature({ it })

const MARKER = 'html-cleanup-pin-4b1e'

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

const metricsFixture = (): Report.MetricsResult => ({
  name: 'All files',
  metrics: Report.Metrics.fromMutants([{ status: 'Killed' }]),
  childResults: [],
})

const dryRunEvent = (): Reporter.ReporterEvent =>
  Reporter.DryRunCompleted.make({
    timing: { net: 1, overhead: 0 },
    capabilities: { reloadEnvironment: false },
    testCount: 0,
    tests: [],
  })

const terminalEvent = (): Reporter.ReporterEvent =>
  Reporter.MutationTestReportReady.make({ report: reportFixture(), metrics: metricsFixture() })

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

Feature('Keeping the report when a run is interrupted').withLayer(nodeFsPathLayer).body(({ scenario }) => {
  scenario(
    'An interrupted run leaves no report behind',
    { live: 'the scenario creates a real temporary directory and reads real files' },
    Gherkin.Do.pipe(
      Given('an output directory')('output', () =>
        Effect.gen(function*() {
          const dir = yield* Effect.promise(() => makeTempDir('html-cleanup-early-'))
          const fileName = yield* Effect.promise(() => joinPath(dir, 'index.html'))
          return { dir, fileName }
        })),
      When('the interrupted run is followed by a completed run')(
        'outcome',
        (s) =>
          Effect.gen(function*() {
            try {
              const options = yield* optionsWith(s.output.fileName)
              const first = HtmlReporter.makeHtmlReporter(options, {})
              yield* first(toStream([dryRunEvent()]))
              const earlyWritten = yield* Effect.promise(() => fileExists(s.output.fileName))
              const followUp = HtmlReporter.makeHtmlReporter(options, {})
              yield* followUp(toStream([dryRunEvent(), terminalEvent()]))
              return { earlyWritten, html: yield* Effect.promise(() => readText(s.output.fileName)) }
            } finally {
              yield* Effect.promise(() => removeDir(s.output.dir))
            }
          }),
      ),
      Then('the interrupted run writes no report and the completed run writes it')((s, expect) =>
        expect(s.outcome).toMatchObject({ earlyWritten: false, html: expect.stringMatching(MARKER) })
      ),
    ),
  )

  scenario(
    'A run that fails after writing its report leaves the report on disk',
    { live: 'the scenario creates a real temporary directory and reads real files' },
    Gherkin.Do.pipe(
      Given('an output directory')('output', () =>
        Effect.gen(function*() {
          const dir = yield* Effect.promise(() => makeTempDir('html-cleanup-abrupt-'))
          const fileName = yield* Effect.promise(() => joinPath(dir, 'index.html'))
          return { dir, fileName }
        })),
      When('the run fails after the report is ready')(
        'outcome',
        (s) =>
          Effect.gen(function*() {
            const breakingStream = (): AsyncIterable<Reporter.ReporterEvent> => {
              let step = 0
              return {
                [Symbol.asyncIterator](): AsyncIterator<Reporter.ReporterEvent> {
                  return {
                    next(): Promise<IteratorResult<Reporter.ReporterEvent>> {
                      step += 1
                      if (step === 1) {
                        return Promise.resolve({ value: terminalEvent(), done: false })
                      }
                      return Promise.reject(new Error('stream broke'))
                    },
                  }
                },
              }
            }
            try {
              const options = yield* optionsWith(s.output.fileName)
              const consume = HtmlReporter.makeHtmlReporter(options, {})
              const failure = yield* Effect.flip(consume(breakingStream())).pipe(
                Effect.map((failed: { readonly cause: string }) => failed.cause),
              )
              const html = yield* Effect.promise(() => readText(s.output.fileName))
              const followUp = HtmlReporter.makeHtmlReporter(options, {})
              yield* followUp(toStream([terminalEvent()]))
              return { failure, html, rerun: yield* Effect.promise(() => readText(s.output.fileName)) }
            } finally {
              yield* Effect.promise(() => removeDir(s.output.dir))
            }
          }),
      ),
      Then('the failure reaches the caller, the written report survives, and the following run writes its report')((
        s,
        expect,
      ) =>
        expect(s.outcome).toMatchObject({
          failure: expect.stringMatching('stream broke'),
          html: expect.stringMatching(MARKER),
          rerun: expect.stringMatching(MARKER),
        })
      ),
    ),
  )
})
