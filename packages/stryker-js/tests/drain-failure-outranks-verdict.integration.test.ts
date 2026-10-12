import { NodeFileSystem, NodePath } from '@effect/platform-node'
import { Gherkin, Given, it, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import { Engine } from '@systemfsoftware/stryker-js'
import { RunEvent } from '@systemfsoftware/stryker-js-cli-contract'
import { Report, Reporter } from '@systemfsoftware/stryker-js-plugin-interface'
import type * as Cause from 'effect/Cause'
import * as Effect from 'effect/Effect'
import * as Exit from 'effect/Exit'
import * as FileSystem from 'effect/FileSystem'
import * as Layer from 'effect/Layer'
import * as Option from 'effect/Option'
import * as Path from 'effect/Path'
import * as Queue from 'effect/Queue'
import * as S from 'effect/Schema'
import * as Stream from 'effect/Stream'

const Feature = makeFeature({ it })

const SOURCE_FILE = 'src/add.ts'
const SOURCE_CONTENT = 'export const add = (left: number, right: number): number => left + right\n'
const PACKAGE_SOURCE = '{ "type": "commonjs" }\n'
const REPORTER_NAME = 'refusing-reporter'

interface ObservedRun {
  readonly exit: Exit.Exit<Engine.MutationTestDone, Engine.StageError>
  readonly report: Option.Option<Report.MutationTestResult>
}

const filePorts = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer)

const reportFileOf = (directory: string): string => `${directory}/reports/mutation/mutation.json`

const refuseFinishedReport = (event: Reporter.ReporterEvent): Effect.Effect<void, Reporter.ReporterFailed> =>
  S.is(Reporter.MutationTestReportReady)(event)
    ? Effect.fail(
      Reporter.ReporterFailed.make({
        reporterName: REPORTER_NAME,
        event: 'mutationTestReportReady',
        cause: 'the reporter refuses the finished report',
      }),
    )
    : Effect.void

const refusingReporter: Reporter.ReporterFactory = () => (events) =>
  Stream.fromAsyncIterable(
    events,
    () =>
      Reporter.ReporterFailed.make({
        reporterName: REPORTER_NAME,
        event: 'mutationTestReportReady',
        cause: 'the run stopped delivering events',
      }),
  ).pipe(Stream.runForEach(refuseFinishedReport))

const writeWorkspace = (): Effect.Effect<string, never, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const directory = yield* fs.makeTempDirectory()
    yield* fs.makeDirectory(path.join(directory, 'src'), { recursive: true })
    yield* fs.writeFileString(path.join(directory, SOURCE_FILE), SOURCE_CONTENT)
    yield* fs.writeFileString(path.join(directory, 'package.json'), PACKAGE_SOURCE)
    return directory
  }).pipe(Effect.orDie)

const removeWorkspace = (directory: string): Effect.Effect<void, never, FileSystem.FileSystem> =>
  Effect.orDie(
    Effect.flatMap(FileSystem.FileSystem, (fs) => fs.remove(directory, { recursive: true, force: true })),
  )

const readReport = (
  directory: string,
): Effect.Effect<Report.MutationTestResult, never, FileSystem.FileSystem> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const text = yield* fs.readFileString(reportFileOf(directory))
    return yield* S.decodeEffect(S.fromJsonString(Report.MutationTestResult))(text)
  }).pipe(Effect.orDie)

const environmentFor = (directory: string): Engine.RunEnvironmentShape => ({
  runId: '01ARZ3NDEKTSV4RRFFQ69G5FAX',
  resolvedMode: { mode: 'machine', signal: 'flag', stdoutIsTTY: false },
  runStartedAt: 0,
  basePath: directory,
  builtinReporters: { [REPORTER_NAME]: refusingReporter },
  allowConsoleColors: false,
})

const executeRun = (directory: string): Effect.Effect<ObservedRun, never, FileSystem.FileSystem> =>
  Effect.gen(function*() {
    const queue = yield* Queue.bounded<RunEvent.RunEvent, Cause.Done>(8192)
    const runLayer = Layer.merge(
      Layer.provide(Engine.RunEnvironment.stage(environmentFor(directory), queue), Engine.nodePlatformLayer),
      Engine.nodePlatformLayer,
    )
    const exit = yield* Engine.mutationTestCell
      .run({
        cliOptions: {
          testRunner: 'command',
          commandRunner: { command: 'true' },
          coverageAnalysis: 'off',
          reporters: ['json', REPORTER_NAME],
          jsonReporter: { fileName: reportFileOf(directory) },
          thresholds: { high: 100, low: 100, break: 100 },
          checkers: [],
          mutate: ['src/**/*.ts'],
          symlinkNodeModules: false,
          incremental: false,
          incrementalFile: `${directory}/reports/stryker-incremental.json`,
          cleanTempDir: 'always',
        },
        targetMutatePatterns: undefined,
      })
      .pipe(Effect.provide(runLayer), Effect.scoped, Effect.exit)
    const report = yield* readReport(directory).pipe(Effect.option)
    return { exit, report }
  })

const runAndClean = (directory: string): Effect.Effect<ObservedRun, never, never> =>
  executeRun(directory).pipe(Effect.ensuring(removeWorkspace(directory)), Effect.provide(filePorts))

const survivorCountOf = (report: Report.MutationTestResult): number =>
  Object.values(report.files).flatMap((file) => file.mutants).filter((mutant) => mutant.status === 'Survived').length

Feature('Deciding how a finished mutation run ends')
  .withLayer(Layer.empty)
  .live('the run is real: it mutates a project on disk, spawns the command runner and drains real reporters')
  .body(({ scenario }) => {
    scenario(
      'A reporter that fails on the finished report outranks a score under the break threshold',
      Gherkin.Do.pipe(
        Given('a project whose every mutant survives, and a reporter that refuses the finished report')(
          'directory',
          () => writeWorkspace().pipe(Effect.provide(filePorts)),
        ),
        When('a mutation run with a break threshold of 100 finishes over that project')(
          'observation',
          (s) => runAndClean(s.directory),
        ),
        Then('the run ends with the reporter failure, not the broken score')((s, expect) => {
          const report = Option.getOrThrowWith(s.observation.report, () => new Error('the run wrote no JSON report'))
          return expect({
            survivorsLeftTheScoreUnderTheThreshold: survivorCountOf(report) > 0,
            verdict: Exit.match(s.observation.exit, {
              onFailure: () => 'the run failed',
              onSuccess: (done) => done.verdict,
            }),
          }).toEqual({
            survivorsLeftTheScoreUnderTheThreshold: true,
            verdict: 'RuntimeError',
          })
        }),
      ),
    )
  })
