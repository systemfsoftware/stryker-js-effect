import { NodeFileSystem, NodePath } from '@effect/platform-node'
import { Gherkin, Given, it, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import { Engine, RunEvent } from '@systemfsoftware/stryker-js'
import { Mutant } from '@systemfsoftware/stryker-js-instrumenter'
import { Report } from '@systemfsoftware/stryker-js-plugin-interface'
import type * as Cause from 'effect/Cause'
import * as Effect from 'effect/Effect'
import * as Exit from 'effect/Exit'
import * as FileSystem from 'effect/FileSystem'
import * as Layer from 'effect/Layer'
import * as Path from 'effect/Path'
import * as Queue from 'effect/Queue'
import * as S from 'effect/Schema'

const Feature = makeFeature({ it })

const filePorts = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer)

const PACKAGE_ROOT = decodeURIComponent(new URL('..', import.meta.url).pathname).replace(/\/$/, '')

/**
 * One mutant in this module returns a promise that never settles: a mutant on the
 * `if` guard takes the never-resolving branch when the covering test calls
 * `settle(true)`. The remaining mutants are finite and are classified from the
 * ordinary covering test. The cover awaits the promise, so no hit counter grows
 * and the wall-clock backstop is the only bound that sees the hang.
 */
const DAEMON_FILE = 'src/lib/daemon.ts'
const DAEMON_SOURCE = [
  'export const settle = (immediate: boolean): Promise<string> => {',
  '  if (immediate) {',
  "    return Promise.resolve('settled')",
  '  }',
  '  return new Promise<string>(() => {})',
  '}',
  '',
  'export const double = (value: number): number => value * 2',
  '',
].join('\n')

const TEST_SOURCE = [
  "import { expect, test } from 'vitest'",
  "import { double, settle } from '../src/lib/daemon.ts'",
  '',
  "test('doubles a number', () => {",
  '  expect(double(3)).toBe(6)',
  '})',
  '',
  "test('settles immediately when asked', async () => {",
  "  await expect(settle(true)).resolves.toBe('settled')",
  '})',
].join('\n')

/**
 * The fixture's own test timeout must not fire before the mutant budget, or the
 * project would classify the hang as a failed test instead of a wall-clock clip.
 */
const VITEST_CONFIG_SOURCE = 'export default { test: { testTimeout: 600_000, hookTimeout: 600_000 } }\n'

const MUTANT_BUDGET_MS = 2_000

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
    const files: ReadonlyArray<readonly [string, string]> = [
      ['package.json', '{ "type": "commonjs" }\n'],
      ['vitest.config.ts', VITEST_CONFIG_SOURCE],
      [DAEMON_FILE, DAEMON_SOURCE],
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
  runId: 'wall-clock-timeout',
  resolvedMode: { mode: 'machine', signal: 'flag', stdoutIsTTY: false },
  runStartedAt: 0,
  basePath: directory,
  builtinReporters: {},
  allowConsoleColors: false,
})

interface MutantRow {
  readonly status: Mutant.MutantStatus
  readonly statusReason?: string | undefined
}

interface ObservedRun {
  readonly exit: Exit.Exit<Engine.MutationTestDone, Engine.StageError>
  readonly events: ReadonlyArray<RunEvent.RunEvent>
  readonly daemonMutants: ReadonlyArray<MutantRow>
}

const readDaemonMutants = (
  directory: string,
): Effect.Effect<ReadonlyArray<MutantRow>, never, FileSystem.FileSystem> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const text = yield* fs.readFileString(reportFileOf(directory))
    const report = yield* S.decodeEffect(S.fromJsonString(Report.MutationTestResultSchema))(text)
    return Object.entries(report.files)
      .filter(([file]) => file === DAEMON_FILE)
      .flatMap(([, fileResult]) =>
        fileResult.mutants.map((mutant): MutantRow => ({
          status: mutant.status,
          statusReason: mutant.statusReason,
        }))
      )
  }).pipe(Effect.orElseSucceed(() => []))

const executeRun = (workspace: Workspace): Effect.Effect<ObservedRun, never, FileSystem.FileSystem> =>
  Effect.gen(function*() {
    const queue = yield* Queue.bounded<RunEvent.RunEvent, Cause.Done>(8192)
    const runLayer = Layer.merge(
      Layer.provide(Engine.RunEnvironment.stage(environmentFor(workspace.directory), queue), Engine.nodePlatformLayer),
      Engine.nodePlatformLayer,
    )
    const exit = yield* Engine.mutationTestCell
      .run({
        cliOptions: {
          testRunner: 'vm',
          plugins: [],
          reporters: ['json'],
          jsonReporter: { fileName: reportFileOf(workspace.directory) },
          thresholds: { high: 60, low: 40, break: 0 },
          checkers: [],
          testFiles: ['test/**/*.mjs'],
          mutate: ['src/**/*.ts'],
          coverageAnalysis: 'perTest',
          timeoutMS: MUTANT_BUDGET_MS,
          timeoutFactor: 0,
          cleanTempDir: 'always',
          incremental: true,
          incrementalFile: incrementalFileOf(workspace.directory),
        },
        targetMutatePatterns: undefined,
      })
      .pipe(Effect.provide(runLayer), Effect.scoped, Effect.exit)
    const events = yield* Queue.takeAll(queue).pipe(Effect.orElseSucceed(() => []))
    const daemonMutants = yield* readDaemonMutants(workspace.directory)
    return { exit, events: [...events], daemonMutants }
  })

const runAndClean = (workspace: Workspace): Effect.Effect<ObservedRun, never, never> =>
  executeRun(workspace).pipe(
    Effect.ensuring(removeWorkspace(workspace.directory)),
    Effect.provide(filePorts),
  )

const verdictOf = (events: ReadonlyArray<RunEvent.RunEvent>): RunEvent.VerdictReached | undefined =>
  events.find(S.is(RunEvent.VerdictReached))

const timeoutStreamed = (events: ReadonlyArray<RunEvent.RunEvent>): boolean =>
  events.some((event) => S.is(RunEvent.RunMutantTested)(event) && event.status === 'Timeout')

Feature('Reporting a mutant that never settles without aborting the run')
  .withLayer(Layer.empty)
  .live('the run spawns the vm worker and drives the real child-process test runner')
  .body(({ scenario }) => {
    scenario(
      'A mutant whose covering test never settles is reported as timed out and the run continues',
      Gherkin.Do.pipe(
        Given('a project whose module can be mutated so its promise never settles')(
          'workspace',
          () => writeWorkspace().pipe(Effect.provide(filePorts)),
        ),
        When('a mutation run executes with a short time budget for each mutant')(
          'observation',
          (s) => runAndClean(s.workspace),
        ),
        Then(
          'the run finishes, the never-settling mutant is recorded as timed out, its siblings keep their results, and the run does not end as an internal failure',
        )((s, expect) => {
          const verdict = verdictOf(s.observation.events)
          const timeouts = s.observation.daemonMutants.filter((mutant) => mutant.status === 'Timeout')
          const wallClockTimeouts = timeouts.filter((mutant) => mutant.statusReason === 'wall-clock-timeout')
          const killed = s.observation.daemonMutants.filter((mutant) => mutant.status === 'Killed')
          const verdictClass = Exit.isSuccess(s.observation.exit) ? s.observation.exit.value.verdict : undefined
          return expect({
            runCompleted: Exit.isSuccess(s.observation.exit),
            verdictReached: verdict !== undefined,
            internalErrorVerdict: verdictClass === 'InternalError',
            wallClockTimeoutReported: wallClockTimeouts.length >= 1,
            timeoutStreamed: timeoutStreamed(s.observation.events),
            verdictCountsTimeout: (verdict?.counts.timeout ?? 0) >= 1,
            siblingsStillClassified: killed.length >= 1,
          }).toEqual({
            runCompleted: true,
            verdictReached: true,
            internalErrorVerdict: false,
            wallClockTimeoutReported: true,
            timeoutStreamed: true,
            verdictCountsTimeout: true,
            siblingsStillClassified: true,
          })
        }),
      ),
    )
  })
