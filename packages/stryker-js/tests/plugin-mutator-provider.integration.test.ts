import { NodeFileSystem, NodePath } from '@effect/platform-node'
import { Gherkin, Given, it, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import { Engine } from '@systemfsoftware/stryker-js'
import { RunEvent } from '@systemfsoftware/stryker-js-cli-contract'
import { Report } from '@systemfsoftware/stryker-js-plugin-interface'
import type * as Cause from 'effect/Cause'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as Layer from 'effect/Layer'
import * as Option from 'effect/Option'
import * as Path from 'effect/Path'
import type { PlatformError } from 'effect/PlatformError'
import * as Queue from 'effect/Queue'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

const Feature = makeFeature({ it })

const PROVIDER_FIXTURES = `${globalThis.process.cwd()}/tests/__fixtures__/mutator-provider`

const pluginUrlOf = (fileName: string): string =>
  globalThis.process.getBuiltinModule('node:url').pathToFileURL(`${PROVIDER_FIXTURES}/${fileName}`).href

const PROVIDER = pluginUrlOf('index.mjs')
const RIVAL = pluginUrlOf('rival.mjs')

const MUTATOR_NAME = 'acme/FlipSide'
const PROVIDER_REPLACEMENT = '"right"'

const SOURCE_FILE = 'src/labels.ts'
const SOURCE_CONTENT = "export const side = (): string => 'left'\n"
const PACKAGE_SOURCE = '{ "type": "commonjs" }\n'

const filePorts = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer)

interface Workspace {
  readonly directory: string
}

const reportFileOf = (directory: string): string => `${directory}/reports/mutation/mutation.json`

const incrementalFileOf = (directory: string): string => `${directory}/reports/stryker-incremental.json`

const writeWorkspace = (): Effect.Effect<Workspace, never, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const directory = yield* fs.makeTempDirectory()
    yield* fs.makeDirectory(path.join(directory, 'src'), { recursive: true })
    yield* fs.writeFileString(path.join(directory, 'package.json'), PACKAGE_SOURCE)
    yield* fs.writeFileString(path.join(directory, SOURCE_FILE), SOURCE_CONTENT)
    return { directory }
  }).pipe(Effect.orDie)

const removeWorkspace = (directory: string): Effect.Effect<void, never, FileSystem.FileSystem> =>
  Effect.orDie(
    Effect.flatMap(FileSystem.FileSystem, (fs) => fs.remove(directory, { recursive: true, force: true })),
  )

const environmentFor = (directory: string): Engine.RunEnvironmentShape => ({
  runId: '01ARZ3NDEKTSV4RRFFQ69G5FAY',
  resolvedMode: { mode: 'machine', signal: 'flag', stdoutIsTTY: false },
  runStartedAt: 0,
  basePath: directory,
  builtinReporters: {},
  allowConsoleColors: false,
})

interface ObservedRun {
  readonly outcome: Result.Result<Engine.MutationTestDone, Engine.StageError | PlatformError>
  readonly events: ReadonlyArray<RunEvent.RunEvent>
  readonly report: Option.Option<Report.MutationTestResult>
}

const readReport = (
  directory: string,
): Effect.Effect<Option.Option<Report.MutationTestResult>, never, FileSystem.FileSystem> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const text = yield* fs.readFileString(reportFileOf(directory))
    return yield* S.decodeEffect(S.fromJsonString(Report.MutationTestResult))(text)
  }).pipe(Effect.option)

interface MutantRow {
  readonly file: string
  readonly mutator: string
  readonly replacement: string | null
}

const streamRowsOf = (events: ReadonlyArray<RunEvent.RunEvent>): readonly MutantRow[] =>
  events.filter(S.is(RunEvent.RunMutantTested)).map((mutant) => ({
    file: mutant.fileName,
    mutator: mutant.mutatorName,
    replacement: mutant.replacement,
  }))

const reportRowsOf = (report: Report.MutationTestResult): readonly MutantRow[] =>
  Object.entries(report.files).flatMap(([file, fileResult]) =>
    fileResult.mutants.map((mutant) => ({
      file,
      mutator: mutant.mutatorName,
      replacement: mutant.replacement ?? null,
    }))
  )

const providerRows = (rows: readonly MutantRow[]): readonly MutantRow[] =>
  rows.filter((row) => row.mutator === MUTATOR_NAME)

const executeRun = (
  workspace: Workspace,
  plugins: readonly string[],
): Effect.Effect<ObservedRun, never, FileSystem.FileSystem> =>
  Effect.gen(function*() {
    const queue = yield* Queue.bounded<RunEvent.RunEvent, Cause.Done>(8192)
    const runLayer = Layer.merge(
      Layer.provide(Engine.RunEnvironment.stage(environmentFor(workspace.directory), queue), Engine.nodePlatformLayer),
      Engine.nodePlatformLayer,
    )
    const outcome = yield* Engine.mutationTestCell
      .run({
        cliOptions: {
          testRunner: 'command',
          commandRunner: { command: 'true' },
          coverageAnalysis: 'off',
          plugins: [...plugins],
          reporters: ['json'],
          jsonReporter: { fileName: reportFileOf(workspace.directory) },
          thresholds: { high: 60, low: 40, break: 0 },
          checkers: [],
          mutate: ['src/**/*.ts'],
          cleanTempDir: 'always',
          incremental: false,
          incrementalFile: incrementalFileOf(workspace.directory),
        },
        targetMutatePatterns: undefined,
      })
      .pipe(Effect.provide(runLayer), Effect.scoped, Effect.result)
    const events = yield* Queue.end(queue).pipe(
      Effect.andThen(Queue.takeAll(queue)),
      Effect.orElseSucceed((): readonly RunEvent.RunEvent[] => []),
    )
    const report = yield* readReport(workspace.directory)
    return { outcome, events: [...events], report }
  })

const runAndClean = (plugins: readonly string[]): Effect.Effect<ObservedRun, never, never> =>
  Effect.gen(function*() {
    const workspace = yield* writeWorkspace()
    return yield* executeRun(workspace, plugins).pipe(Effect.ensuring(removeWorkspace(workspace.directory)))
  }).pipe(Effect.provide(filePorts))

const reportOf = (run: ObservedRun): Report.MutationTestResult =>
  Option.getOrThrowWith(run.report, () => new Error('the run wrote no JSON report'))

const failureTextOf = (run: ObservedRun): string =>
  Result.isFailure(run.outcome) && S.is(Engine.StageError)(run.outcome.failure)
    ? run.outcome.failure.message
    : 'no prepare refusal'

const stageOf = (run: ObservedRun): string | null =>
  Result.isFailure(run.outcome) && S.is(Engine.StageError)(run.outcome.failure) ? run.outcome.failure.stage : null

Feature('A plugin contributing a namespaced mutator catalog')
  .withLayer(Layer.empty)
  .live('the run loads the real fixture module, instruments a real project and writes a real report')
  .body(({ scenario }) => {
    scenario(
      'A loaded provider names itself in the machine stream and in the report',
      Gherkin.Do.pipe(
        Given('a provider module exporting a namespaced mutator catalog')('plugins', () => Effect.succeed([PROVIDER])),
        When('a mutation run loads it and mutates a project')('observation', (s) => runAndClean(s.plugins)),
        Then('the provider mutant is reported under its namespaced name by the stream and by the report')((
          s,
          expect,
        ) => {
          const stream = providerRows(streamRowsOf(s.observation.events))
          const report = providerRows(reportRowsOf(reportOf(s.observation)))
          return expect({
            verdictReached: Result.isSuccess(s.observation.outcome),
            stream: stream.map((row) => ({ mutator: row.mutator, replacement: row.replacement })),
            report: report.map((row) => ({ mutator: row.mutator, replacement: row.replacement })),
          }).toEqual({
            verdictReached: true,
            stream: [{ mutator: MUTATOR_NAME, replacement: PROVIDER_REPLACEMENT }],
            report: [{ mutator: MUTATOR_NAME, replacement: PROVIDER_REPLACEMENT }],
          })
        }),
      ),
    )

    scenario(
      'Two providers claiming one namespace stop the run before instrumentation',
      Gherkin.Do.pipe(
        Given('two provider modules declaring the same namespace')('plugins', () => Effect.succeed([PROVIDER, RIVAL])),
        When('a mutation run loads both')('observation', (s) => runAndClean(s.plugins)),
        Then('the run is refused while preparing, and the refusal names both modules')((s, expect) => {
          const message = failureTextOf(s.observation)
          return expect({
            refused: Result.isFailure(s.observation.outcome),
            stage: stageOf(s.observation),
            prepareFailureNamed: message.includes('Prepare failed'),
            providerNamed: message.includes('mutator-provider/index.mjs'),
            rivalNamed: message.includes('mutator-provider/rival.mjs'),
            namespaceNamed: message.includes('acme'),
          }).toEqual({
            refused: true,
            stage: 'prepare',
            prepareFailureNamed: true,
            providerNamed: true,
            rivalNamed: true,
            namespaceNamed: true,
          })
        }),
      ),
    )
  })
