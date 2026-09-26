import { NodeFileSystem, NodePath } from '@effect/platform-node'
import { Gherkin, Given, it, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import { Engine, RunEvent } from '@systemfsoftware/stryker-js'
import { Report, type Reporter } from '@systemfsoftware/stryker-js-plugin-interface'
import type * as Cause from 'effect/Cause'
import * as Effect from 'effect/Effect'
import * as Exit from 'effect/Exit'
import * as FileSystem from 'effect/FileSystem'
import * as Layer from 'effect/Layer'
import * as Option from 'effect/Option'
import * as Path from 'effect/Path'
import * as Queue from 'effect/Queue'
import * as S from 'effect/Schema'

import {
  makeSlowReporter,
  SlowConsumer,
  SlowReporterObservationSchema,
  turnsCostingMilliseconds,
} from './__fixtures__/slow-reporter.fixture.js'
import type { SlowReporterObservation } from './__fixtures__/slow-reporter.fixture.js'

const Feature = makeFeature({ it })

const SOURCE_FILE = 'src/add.ts'
const SOURCE_CONTENT = 'export const add = (left: number, right: number): number => left + right\n'
const PACKAGE_SOURCE = '{ "type": "commonjs" }\n'
const OBSERVATION_FILE = 'slow-reporter-observation.json'
const REPORTER_NAME = 'slow-reporter'

interface Workspace {
  readonly directory: string
  readonly markerPath: string
}

interface ObservedRun {
  readonly exit: Exit.Exit<Engine.MutationTestDone, Engine.StageError>
  readonly observation: Option.Option<SlowReporterObservation>
  readonly report: Option.Option<typeof Report.MutationTestResultSchema.Type>
}

const filePorts = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer)

const reportFileOf = (directory: string): string => `${directory}/reports/mutation/mutation.json`

const writeWorkspace = (): Effect.Effect<Workspace, never, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const directory = yield* fs.makeTempDirectory()
    yield* fs.makeDirectory(path.join(directory, 'src'), { recursive: true })
    yield* fs.writeFileString(path.join(directory, SOURCE_FILE), SOURCE_CONTENT)
    yield* fs.writeFileString(path.join(directory, 'package.json'), PACKAGE_SOURCE)
    return { directory, markerPath: path.join(directory, OBSERVATION_FILE) }
  }).pipe(Effect.orDie)

const removeWorkspace = (directory: string): Effect.Effect<void, never, FileSystem.FileSystem> =>
  Effect.orDie(
    Effect.flatMap(FileSystem.FileSystem, (fs) => fs.remove(directory, { recursive: true, force: true })),
  )

const readReport = (
  directory: string,
): Effect.Effect<typeof Report.MutationTestResultSchema.Type, never, FileSystem.FileSystem> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const text = yield* fs.readFileString(reportFileOf(directory))
    return yield* S.decodeEffect(S.fromJsonString(Report.MutationTestResultSchema))(text)
  }).pipe(Effect.orDie)

const readObservation = (
  markerPath: string,
): Effect.Effect<SlowReporterObservation, never, FileSystem.FileSystem> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const text = yield* fs.readFileString(markerPath)
    return yield* S.decodeEffect(S.fromJsonString(SlowReporterObservationSchema))(text)
  }).pipe(Effect.orDie)

const environmentFor = (
  workspace: Workspace,
  slowReporter: Reporter.ReporterFactory,
): Engine.RunEnvironmentShape => ({
  runId: '01ARZ3NDEKTSV4RRFFQ69G5FAX',
  resolvedMode: { mode: 'machine', signal: 'flag', stdoutIsTTY: false },
  runStartedAt: 0,
  basePath: workspace.directory,
  builtinReporters: { [REPORTER_NAME]: slowReporter },
  allowConsoleColors: false,
})

const executeRun = (
  workspace: Workspace,
  slowReporter: Reporter.ReporterFactory,
): Effect.Effect<ObservedRun, never, FileSystem.FileSystem> =>
  Effect.gen(function*() {
    const queue = yield* Queue.bounded<RunEvent.RunEvent, Cause.Done>(8192)
    const runLayer = Layer.merge(
      Layer.provide(
        Engine.RunEnvironment.stage(environmentFor(workspace, slowReporter), queue),
        Engine.nodePlatformLayer,
      ),
      Engine.nodePlatformLayer,
    )
    const exit = yield* Engine.mutationTestCell
      .run({
        cliOptions: {
          testRunner: 'command',
          commandRunner: { command: 'true' },
          coverageAnalysis: 'off',
          reporters: ['json', REPORTER_NAME],
          jsonReporter: { fileName: reportFileOf(workspace.directory) },
          thresholds: { high: 60, low: 40, break: 0 },
          checkers: [],
          mutate: ['src/**/*.ts'],
          symlinkNodeModules: false,
          incremental: false,
          incrementalFile: `${workspace.directory}/reports/stryker-incremental.json`,
          cleanTempDir: 'always',
        },
        targetMutatePatterns: undefined,
      })
      .pipe(Effect.provide(runLayer), Effect.scoped, Effect.exit)
    const observation = yield* readObservation(workspace.markerPath).pipe(Effect.option)
    const report = yield* readReport(workspace.directory).pipe(Effect.option)
    return { exit, observation, report }
  })

const runAndClean = (
  workspace: Workspace,
  slowReporter: Reporter.ReporterFactory,
): Effect.Effect<ObservedRun, never, never> =>
  executeRun(workspace, slowReporter).pipe(
    Effect.ensuring(removeWorkspace(workspace.directory)),
    Effect.provide(filePorts),
  )

const reportOf = (run: ObservedRun): typeof Report.MutationTestResultSchema.Type =>
  Option.getOrThrowWith(run.report, () => new Error('the run wrote no JSON report'))

const observationOf = (run: ObservedRun): SlowReporterObservation =>
  Option.getOrThrowWith(run.observation, () => new Error('the slow reporter never finished consuming the run'))

const mutantCountOf = (report: typeof Report.MutationTestResultSchema.Type): number =>
  Object.values(report.files).reduce((total, file) => total + file.mutants.length, 0)

const expectedEventTags = (report: typeof Report.MutationTestResultSchema.Type): readonly string[] => [
  'dryRunCompleted',
  'mutationTestingPlanReady',
  ...Array.from({ length: mutantCountOf(report) }, () => 'mutantTested'),
  'mutationTestReportReady',
]

Feature('Reporting a finished mutation run to every configured reporter')
  .withLayer(Layer.empty)
  .live(
    `the run is real and the slow reporter spends ${SlowConsumer.millisecondsPerEvent} milliseconds worth of event-loop turns on every event, which no virtual clock can replace`,
  )
  .body(({ scenario }) => {
    scenario(
      'A slow reporter still receives the finished run',
      Gherkin.Do.pipe(
        Given('a project whose run reports through a reporter that drains every event slowly')(
          'fixture',
          () =>
            Effect.gen(function*() {
              const workspace = yield* writeWorkspace()
              const turnsPerEvent = yield* turnsCostingMilliseconds(SlowConsumer.millisecondsPerEvent)
              return { workspace, slowReporter: makeSlowReporter({ markerPath: workspace.markerPath, turnsPerEvent }) }
            }).pipe(Effect.provide(filePorts), Effect.orDie),
        ),
        When('a mutation run finishes over that project')(
          'observation',
          (s) => runAndClean(s.fixture.workspace, s.fixture.slowReporter),
        ),
        Then(
          'the slow reporter has received the finished report, the same report the run also wrote to disk',
        )((s, expect) => {
          const observation = observationOf(s.observation)
          const report = reportOf(s.observation)
          const reportFiles = Object.keys(report.files).sort()
          const mutantCount = mutantCountOf(report)
          if (mutantCount === 0) {
            throw new Error('the run mutated nothing, so the reporter events it should have received are unknowable')
          }
          return expect({
            runSucceeded: Exit.isSuccess(s.observation.exit),
            jsonReportWritten: Option.isSome(s.observation.report),
            slowReporterTerminalReady: observation.terminalReportReady,
            slowReporterEvents: observation.eventTags,
            terminalReportFiles: observation.terminalReportFiles,
            reportFilesWrittenToDisk: reportFiles,
            terminalMutantsTotal: observation.terminalMutantsTotal,
            mutantsInReport: mutantCount,
          }).toEqual({
            runSucceeded: true,
            jsonReportWritten: true,
            slowReporterTerminalReady: true,
            slowReporterEvents: expectedEventTags(report),
            terminalReportFiles: reportFiles,
            reportFilesWrittenToDisk: reportFiles,
            terminalMutantsTotal: mutantCount,
            mutantsInReport: mutantCount,
          })
        }),
      ),
    )
  })
