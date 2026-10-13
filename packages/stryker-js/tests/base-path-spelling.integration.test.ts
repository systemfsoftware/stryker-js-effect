import { Gherkin, Given, it, makeFeature, Then } from '@systemfsoftware/effect-gherkin-spec'
import { Engine } from '@systemfsoftware/stryker-js'
import { RunEvent } from '@systemfsoftware/stryker-js-cli-contract'
import { type Options } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Cause from 'effect/Cause'
import * as Effect from 'effect/Effect'
import * as Exit from 'effect/Exit'
import * as FileSystem from 'effect/FileSystem'
import * as Layer from 'effect/Layer'
import * as Path from 'effect/Path'
import * as Queue from 'effect/Queue'

import {
  INCREMENTAL_FILE,
  jsProjectFiles,
  lineCountOf,
  logFile,
  type ProjectFiles,
  REPORT_FILE,
  type ScoredMutant,
  scoredMutantsOf,
  scratchDirectory,
  statusesOf,
  writeProject,
} from './__fixtures__/cli-project.fixture.js'

const Feature = makeFeature({ it })

const environmentFor = (basePath: string): Engine.RunEnvironmentShape => ({
  runId: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
  resolvedMode: { mode: 'machine', signal: 'flag', stdoutIsTTY: false },
  runStartedAt: 0,
  basePath,
  builtinReporters: {},
  allowConsoleColors: false,
})

const optionsOf = (basePath: string): Options.PartialStrykerOptions => ({
  testRunner: 'vm',
  plugins: [],
  reporters: ['json'],
  jsonReporter: { fileName: `${basePath}/${REPORT_FILE}` },
  checkers: [],
  mutate: ['src/**/*.js'],
  coverageAnalysis: 'perTest',
  cleanTempDir: 'always',
  thresholds: { high: 80, low: 60, break: null },
  incremental: true,
  incrementalFile: `${basePath}/${INCREMENTAL_FILE}`,
})

const apiProjectFiles = (log: string): ProjectFiles =>
  jsProjectFiles({ log }).filter(([file]) => file !== 'stryker.config.mjs')

interface ApiRun {
  readonly failure: string
  readonly scored: readonly ScoredMutant[]
  readonly executions: number
}

const runThroughApi = (
  basePath: string,
  log: string,
  reportsRoot: string = basePath,
): Effect.Effect<ApiRun, never, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*() {
    const before = yield* lineCountOf(log)
    const queue = yield* Queue.bounded<RunEvent.RunEvent, Cause.Done>(RunEvent.RunEvent.QUEUE_BOUND)
    const ports = Engine.nodePlatformLayer
    const runLayer = Layer.merge(
      Layer.provide(Engine.RunEnvironment.layerStage(environmentFor(basePath), queue), ports),
      ports,
    )
    const exit = yield* Engine.mutationTestCell
      .run({ cliOptions: optionsOf(reportsRoot), targetMutatePatterns: undefined })
      .pipe(Effect.provide(runLayer), Effect.scoped, Effect.exit)
    yield* Queue.end(queue).pipe(Effect.andThen(Queue.takeAll(queue)), Effect.ignore)
    return {
      failure: Exit.match(exit, { onFailure: (cause) => Cause.pretty(cause), onSuccess: () => '' }),
      scored: yield* scoredMutantsOf(reportsRoot),
      executions: (yield* lineCountOf(log)) - before,
    }
  })

Feature('Running mutation testing through the API on one project whose base path is spelled two ways')
  .withLayer(Engine.nodePlatformLayer)
  .live('the engine runs real projects in temporary directories through its public API')
  .body(({ scenario }) => {
    scenario(
      'A run from the real path of a project last run through a symlink scores every mutant as a fresh run',
      Gherkin.Do.pipe(
        Given('a project run through a symlink to its directory, then through its real path, and a copy run fresh')(
          'observed',
          () =>
            Effect.scoped(Effect.gen(function*() {
              const fs = yield* FileSystem.FileSystem
              const path = yield* Path.Path
              const log = yield* logFile
              const project = yield* writeProject(apiProjectFiles(log))
              const link = path.join(yield* scratchDirectory, 'project')
              yield* Effect.orDie(fs.symlink(project, link))
              const viaLink = yield* runThroughApi(link, log)
              const viaRealPath = yield* runThroughApi(project, log)
              const freshLog = yield* logFile
              const fresh = yield* runThroughApi(yield* writeProject(apiProjectFiles(freshLog)), freshLog)
              return { viaLink, viaRealPath, fresh }
            })),
        ),
        Then('the run through the real path scores and executes exactly as the fresh run')((s, expect) =>
          expect({
            failures: [s.observed.viaLink, s.observed.viaRealPath, s.observed.fresh].map((run) => run.failure),
            freshStatuses: statusesOf(s.observed.fresh.scored),
            viaLinkScored: s.observed.viaLink.scored,
            viaRealPathScored: s.observed.viaRealPath.scored,
            viaRealPathExecutions: s.observed.viaRealPath.executions,
          }).toEqual({
            failures: ['', '', ''],
            freshStatuses: ['Killed', 'NoCoverage'],
            viaLinkScored: s.observed.fresh.scored,
            viaRealPathScored: s.observed.fresh.scored,
            viaRealPathExecutions: s.observed.fresh.executions,
          })
        ),
      ),
    )
    scenario(
      'A run from the absolute path of a project last run from a relative path scores every mutant as a fresh run',
      Gherkin.Do.pipe(
        Given(
          'a project run from a path relative to the working directory, then from its absolute path, and a copy run fresh',
        )(
          'observed',
          () =>
            Effect.scoped(Effect.gen(function*() {
              const path = yield* Path.Path
              const log = yield* logFile
              const project = yield* writeProject(apiProjectFiles(log))
              const viaRelativePath = yield* runThroughApi(
                path.relative(globalThis.process.cwd(), project),
                log,
                project,
              )
              const viaAbsolutePath = yield* runThroughApi(project, log)
              const freshLog = yield* logFile
              const fresh = yield* runThroughApi(yield* writeProject(apiProjectFiles(freshLog)), freshLog)
              return { viaRelativePath, viaAbsolutePath, fresh }
            })),
        ),
        Then('the run from the absolute path scores and executes exactly as the fresh run')((s, expect) =>
          expect({
            failures: [s.observed.viaRelativePath, s.observed.viaAbsolutePath, s.observed.fresh].map((run) =>
              run.failure
            ),
            freshStatuses: statusesOf(s.observed.fresh.scored),
            viaRelativePathScored: s.observed.viaRelativePath.scored,
            viaAbsolutePathScored: s.observed.viaAbsolutePath.scored,
            viaAbsolutePathExecutions: s.observed.viaAbsolutePath.executions,
          }).toEqual({
            failures: ['', '', ''],
            freshStatuses: ['Killed', 'NoCoverage'],
            viaRelativePathScored: s.observed.fresh.scored,
            viaAbsolutePathScored: s.observed.fresh.scored,
            viaAbsolutePathExecutions: s.observed.fresh.executions,
          })
        ),
      ),
    )
  })
