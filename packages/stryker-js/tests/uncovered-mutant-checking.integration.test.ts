import { NodeFileSystem, NodePath } from '@effect/platform-node'
import { Gherkin, Given, it, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import { Cli, Engine } from '@systemfsoftware/stryker-js'
import { RunEvent } from '@systemfsoftware/stryker-js-cli-contract'
import { Mutant } from '@systemfsoftware/stryker-js-plugin-interface'
import { Report } from '@systemfsoftware/stryker-js-plugin-interface'
import { mergeConfig } from '@systemfsoftware/stryker-js/config'
import type * as Cause from 'effect/Cause'
import * as Effect from 'effect/Effect'
import * as Exit from 'effect/Exit'
import * as FileSystem from 'effect/FileSystem'
import * as Layer from 'effect/Layer'
import * as Option from 'effect/Option'
import * as Path from 'effect/Path'
import * as Queue from 'effect/Queue'
import * as S from 'effect/Schema'

const Feature = makeFeature({ it })

const filePorts = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer)

const PACKAGE_ROOT = decodeURIComponent(new URL('..', import.meta.url).pathname).replace(/\/$/, '')

const CHECKER_PLUGIN = new URL('./__fixtures__/rejecting-checker/index.mjs', import.meta.url).href

const REJECTION_REASON = 'rejected by the fixture checker'

const COVERED_FILE = 'src/lib/covered.ts'
const REJECTED_FILE = 'src/lib/rejected.ts'
const UNREACHED_FILE = 'src/lib/unreached.ts'

const COVERED_SOURCE = 'export const covered = (value: number): number => value * 2\n'
const REJECTED_SOURCE = 'export const rejected = (value: number): number => value + 1\n'
const UNREACHED_SOURCE = 'export const unreached = (value: number): number => value + 1\n'

const TEST_SOURCE = [
  "import { expect, test } from 'vitest'",
  "import { covered } from '../src/lib/covered.ts'",
  '',
  "test('doubles a number', () => {",
  '  expect(covered(3)).toBe(6)',
  '})',
].join('\n')

const VITEST_CONFIG_SOURCE = 'export default { test: { testTimeout: 600_000, hookTimeout: 600_000 } }\n'

interface Workspace {
  readonly directory: string
}

const reportFileOf = (directory: string): string => `${directory}/reports/mutation/mutation.json`

const writeWorkspace = (): Effect.Effect<Workspace, never, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const directory = yield* fs.makeTempDirectory()
    const files: ReadonlyArray<readonly [string, string]> = [
      ['package.json', '{ "type": "commonjs" }\n'],
      ['vitest.config.ts', VITEST_CONFIG_SOURCE],
      [COVERED_FILE, COVERED_SOURCE],
      [REJECTED_FILE, REJECTED_SOURCE],
      [UNREACHED_FILE, UNREACHED_SOURCE],
      ['test/sample.test.mjs', TEST_SOURCE],
    ]
    yield* Effect.forEach(
      files,
      ([name, content]) =>
        Effect.gen(function*() {
          const target = path.join(directory, name)
          yield* fs.makeDirectory(path.dirname(target), { recursive: true })
          yield* fs.writeFileString(target, content)
        }),
      { discard: true },
    )
    yield* fs.symlink(path.join(PACKAGE_ROOT, 'node_modules'), path.join(directory, 'node_modules'))
    return { directory }
  }).pipe(Effect.orDie)

const removeWorkspace = (directory: string): Effect.Effect<void, never, FileSystem.FileSystem> =>
  Effect.orDie(
    Effect.flatMap(FileSystem.FileSystem, (fs) => fs.remove(directory, { recursive: true, force: true })),
  )

const environmentFor = (directory: string): Engine.RunEnvironmentShape => ({
  runId: '01ARZ3NDEKTSV4RRFFQ69G5FAW',
  resolvedMode: { mode: 'machine', signal: 'flag', stdoutIsTTY: false },
  runStartedAt: 0,
  basePath: directory,
  builtinReporters: {},
  configOverlay: mergeConfig,
  allowConsoleColors: false,
})

interface MutantRow {
  readonly status: Mutant.MutantStatus
  readonly statusReason?: string | undefined
  readonly testsCompleted?: number | undefined
}

interface MutantRows {
  readonly covered: readonly MutantRow[]
  readonly rejected: readonly MutantRow[]
  readonly unreached: readonly MutantRow[]
}

interface ObservedRun extends MutantRows {
  readonly exit: Exit.Exit<Engine.MutationTestDone, Engine.StageError>
  readonly events: ReadonlyArray<RunEvent.RunEvent>
}

const rowsOf = (report: Report.MutationTestResult, file: string): readonly MutantRow[] =>
  Option.getOrElse(
    Option.map(Option.fromUndefinedOr(report.files[file]), (fileResult) =>
      fileResult.mutants.map((mutant): MutantRow => ({
        status: mutant.status,
        statusReason: mutant.statusReason,
        testsCompleted: mutant.testsCompleted,
      }))),
    () => [],
  )

const readMutants = (directory: string): Effect.Effect<MutantRows, never, FileSystem.FileSystem> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const text = yield* fs.readFileString(reportFileOf(directory))
    const report = yield* S.decodeEffect(S.fromJsonString(Report.MutationTestResult))(text)
    return {
      covered: rowsOf(report, COVERED_FILE),
      rejected: rowsOf(report, REJECTED_FILE),
      unreached: rowsOf(report, UNREACHED_FILE),
    }
  }).pipe(
    Effect.orElseSucceed((): MutantRows => ({ covered: [], rejected: [], unreached: [] })),
  )

const executeRun = (workspace: Workspace): Effect.Effect<ObservedRun, never, FileSystem.FileSystem> =>
  Effect.gen(function*() {
    const queue = yield* Queue.bounded<RunEvent.RunEvent, Cause.Done>(RunEvent.RunEvent.QUEUE_BOUND)
    const runLayer = Layer.merge(
      Layer.provide(Engine.stage(environmentFor(workspace.directory), queue), Cli.platformLayer),
      Cli.platformLayer,
    )
    const exit = yield* Engine.mutationTestCell
      .run({
        cliOptions: {
          testRunner: 'vm',
          plugins: [],
          reporters: ['json'],
          jsonReporter: { fileName: reportFileOf(workspace.directory) },
          thresholds: { high: 60, low: 40, break: 0 },
          checkers: [{ plugin: CHECKER_PLUGIN }],
          testFiles: ['test/**/*.mjs'],
          mutate: ['src/**/*.ts'],
          coverageAnalysis: 'perTest',
          cleanTempDir: 'always',
          incremental: false,
        },
        targetMutatePatterns: undefined,
      })
      .pipe(Effect.provide(runLayer), Effect.scoped, Effect.exit)
    const events = yield* Queue.takeAll(queue).pipe(Effect.orElseSucceed(() => []))
    const rows = yield* readMutants(workspace.directory)
    return { exit, events: [...events], ...rows }
  })

const runAndClean = (workspace: Workspace): Effect.Effect<ObservedRun, never, never> =>
  executeRun(workspace).pipe(
    Effect.ensuring(removeWorkspace(workspace.directory)),
    Effect.provide(filePorts),
  )

const statusesOf = (rows: readonly MutantRow[]): readonly Mutant.MutantStatus[] => rows.map((row) => row.status)

const reasonsOf = (rows: readonly MutantRow[]): readonly string[] => rows.map((row) => row.statusReason ?? '')

const runsWithoutTests = (rows: readonly MutantRow[]): readonly MutantRow[] =>
  rows.filter((row) => row.status === 'NoCoverage' && (row.testsCompleted ?? 0) > 0)

const zeroTestTimeouts = (rows: readonly MutantRow[]): readonly MutantRow[] =>
  rows.filter((row) => row.status === 'Timeout' && (row.testsCompleted ?? 0) === 0)

Feature('Checking mutants no test covers before settling them NoCoverage', { timeout: 120_000 })
  .withLayer(Layer.empty)
  .live('the run loads a checker worker, spawns the vm test runner, and writes a real report')
  .body(({ scenario }) => {
    scenario(
      'A checker that rejects an uncovered mutant reports it CompileError instead of NoCoverage',
      Gherkin.Do.pipe(
        Given('a project whose tests reach one module and no test reaches two others')(
          'workspace',
          () => writeWorkspace().pipe(Effect.provide(filePorts)),
        ),
        When('a mutation run resolves the uncovered mutants with a checker configured')(
          'observation',
          (s) => runAndClean(s.workspace),
        ),
        Then(
          'every mutant of the rejected uncovered module is a CompileError naming the checker, the passed uncovered module is NoCoverage, the covered module ran, and no mutant without executed tests is a Timeout',
        )((s, expect) => {
          const rejectedStatuses = statusesOf(s.observation.rejected)
          const unreachedStatuses = statusesOf(s.observation.unreached)
          const coveredStatuses = statusesOf(s.observation.covered)
          const allRows = [
            ...s.observation.rejected,
            ...s.observation.unreached,
            ...s.observation.covered,
          ]
          return expect({
            runSucceeded: Exit.isSuccess(s.observation.exit),
            everyRejectedMutantIsCompileError: rejectedStatuses.length > 0 &&
              rejectedStatuses.every((status) => status === 'CompileError'),
            rejectionReasonIsForwarded: reasonsOf(s.observation.rejected).every((reason) =>
              reason.includes(REJECTION_REASON)
            ),
            noRejectedMutantIsNoCoverage: rejectedStatuses.every((status) => status !== 'NoCoverage'),
            everyUnreachedMutantIsNoCoverage: unreachedStatuses.length > 0 &&
              unreachedStatuses.every((status) => status === 'NoCoverage'),
            coveredModuleRan: coveredStatuses.some((status) => status === 'Killed' || status === 'Survived'),
            noCoverageRowsThatRanTests: runsWithoutTests(allRows).length,
            timeoutsWithoutTests: zeroTestTimeouts(allRows).length,
          }).toEqual({
            runSucceeded: true,
            everyRejectedMutantIsCompileError: true,
            rejectionReasonIsForwarded: true,
            noRejectedMutantIsNoCoverage: true,
            everyUnreachedMutantIsNoCoverage: true,
            coveredModuleRan: true,
            noCoverageRowsThatRanTests: 0,
            timeoutsWithoutTests: 0,
          })
        }),
      ),
    )
  })
