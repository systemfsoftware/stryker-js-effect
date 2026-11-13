import { NodeFileSystem, NodePath } from '@effect/platform-node'
import { Gherkin, Given, it, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import { Engine } from '@systemfsoftware/stryker-js'
import { RunEvent } from '@systemfsoftware/stryker-js-cli-contract'
import { Mutant } from '@systemfsoftware/stryker-js-plugin-interface'
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

const DAEMON_FILE = 'src/lib/daemon.ts'
const daemonSourceOf = (secondBranch: ReadonlyArray<string>, imports: ReadonlyArray<string>): string =>
  [
    ...imports,
    'export const settle = (immediate: boolean): Promise<string> => {',
    '  if (immediate) {',
    "    return Promise.resolve('settled')",
    '  }',
    ...secondBranch,
    '}',
    '',
    'export const double = (value: number): number => value * 2',
    '',
  ].join('\n')

const NEVER_SETTLING_DAEMON = daemonSourceOf(['  return new Promise<string>(() => {})'], [])

const HANGS_ONCE_DAEMON = daemonSourceOf(
  ['  return firstCallHangs()'],
  ["import { firstCallHangs } from '../../helpers/first-call-hangs.mjs'", ''],
)
const MARKER_FILE = 'hung-once.marker'
const firstCallHangsSourceOf = (marker: string): string =>
  [
    "import { existsSync, writeFileSync } from 'node:fs'",
    '',
    'export const firstCallHangs = () => {',
    `  if (existsSync(${JSON.stringify(marker)})) {`,
    "    return Promise.resolve('settled')",
    '  }',
    `  writeFileSync(${JSON.stringify(marker)}, '')`,
    '  return Promise.withResolvers().promise',
    '}',
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

type DaemonVariant = 'never-settles' | 'hangs-once'

interface Workspace {
  readonly directory: string
}

const reportFileOf = (directory: string): string => `${directory}/reports/mutation/mutation.json`
const incrementalFileOf = (directory: string): string => `${directory}/reports/stryker-incremental.json`
const markerFileOf = (directory: string): string => `${directory}/${MARKER_FILE}`

const filesOf = (
  variant: DaemonVariant,
  directory: string,
): ReadonlyArray<readonly [string, string]> => [
  ['package.json', '{ "type": "commonjs" }\n'],
  ['vitest.config.ts', VITEST_CONFIG_SOURCE],
  ['test/sample.test.mjs', TEST_SOURCE],
  ...(variant === 'never-settles'
    ? [[DAEMON_FILE, NEVER_SETTLING_DAEMON] as const]
    : [
      [DAEMON_FILE, HANGS_ONCE_DAEMON] as const,
      ['helpers/first-call-hangs.mjs', firstCallHangsSourceOf(markerFileOf(directory))] as const,
    ]),
]

const writeWorkspace = (variant: DaemonVariant): Effect.Effect<Workspace, never, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const directory = yield* fs.makeTempDirectory()
    yield* Effect.forEach(
      filesOf(variant, directory),
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
  runId: '01ARZ3NDEKTSV4RRFFQ69G5FAY',
  resolvedMode: { mode: 'machine', signal: 'flag', stdoutIsTTY: false },
  runStartedAt: 0,
  basePath: directory,
  builtinReporters: {},
  allowConsoleColors: false,
})

interface MutantRow {
  readonly id: string
  readonly status: Mutant.MutantStatus
  readonly statusReason?: string | undefined
}

interface ObservedRun {
  readonly exit: Exit.Exit<Engine.MutationTestDone, Engine.StageError>
  readonly events: ReadonlyArray<RunEvent.RunEvent>
  readonly daemonMutants: ReadonlyArray<MutantRow>
  readonly recordedCostMs: Readonly<Record<string, number | null>>
}

const readDaemonMutants = (
  directory: string,
): Effect.Effect<ReadonlyArray<MutantRow>, never, FileSystem.FileSystem> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const text = yield* fs.readFileString(reportFileOf(directory))
    const report = yield* S.decodeEffect(S.fromJsonString(Report.MutationTestResult))(text)
    return Object.entries(report.files)
      .filter(([file]) => file === DAEMON_FILE)
      .flatMap(([, fileResult]) =>
        fileResult.mutants.map((mutant): MutantRow => ({
          id: mutant.id,
          status: mutant.status,
          statusReason: mutant.statusReason,
        }))
      )
  }).pipe(Effect.orElseSucceed(() => []))

const readRecordedCosts = (
  directory: string,
): Effect.Effect<Readonly<Record<string, number | null>>, never, FileSystem.FileSystem> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const text = yield* fs.readFileString(incrementalFileOf(directory))
    const record = yield* S.decodeEffect(S.fromJsonString(Engine.IncrementalReportSchema))(text)
    return Object.fromEntries(Object.entries(record.costs).map(([id, cost]) => [id, cost.actualMs]))
  }).pipe(Effect.orElseSucceed(() => ({})))

const executeRun = (workspace: Workspace): Effect.Effect<ObservedRun, never, FileSystem.FileSystem> =>
  Effect.gen(function*() {
    const queue = yield* Queue.bounded<RunEvent.RunEvent, Cause.Done>(8192)
    const runLayer = Layer.merge(
      Layer.provide(
        Engine.RunEnvironment.layerStage(environmentFor(workspace.directory), queue),
        Engine.nodePlatformLayer,
      ),
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
    const recordedCostMs = yield* readRecordedCosts(workspace.directory)
    return { exit, events: [...events], daemonMutants, recordedCostMs }
  })

interface ObservedRuns {
  readonly first: ObservedRun
  readonly second: ObservedRun
}

const runTwiceAndClean = (workspace: Workspace): Effect.Effect<ObservedRuns, never, never> =>
  Effect.gen(function*() {
    const first = yield* executeRun(workspace)
    const second = yield* executeRun(workspace)
    return { first, second }
  }).pipe(
    Effect.ensuring(removeWorkspace(workspace.directory)),
    Effect.provide(filePorts),
  )

interface HangOnceObservation {
  readonly run: ObservedRun
  readonly hangHappened: boolean
}

const runOnceAndClean = (workspace: Workspace): Effect.Effect<HangOnceObservation, never, never> =>
  Effect.gen(function*() {
    const run = yield* executeRun(workspace)
    const fs = yield* FileSystem.FileSystem
    const hangHappened = yield* fs.exists(markerFileOf(workspace.directory)).pipe(Effect.orElseSucceed(() => false))
    return { run, hangHappened }
  }).pipe(
    Effect.ensuring(removeWorkspace(workspace.directory)),
    Effect.provide(filePorts),
  )

const verdictOf = (events: ReadonlyArray<RunEvent.RunEvent>): RunEvent.VerdictReached | undefined =>
  events.find(S.is(RunEvent.VerdictReached))

const reuseOf = (events: ReadonlyArray<RunEvent.RunEvent>): RunEvent.ReuseReported | undefined =>
  events.find(S.is(RunEvent.ReuseReported))

const timeoutStreamed = (events: ReadonlyArray<RunEvent.RunEvent>): boolean =>
  events.some((event) => S.is(RunEvent.RunMutantTested)(event) && event.status === 'Timeout')

const wallClockTimeoutsOf = (run: ObservedRun): ReadonlyArray<MutantRow> =>
  run.daemonMutants.filter((mutant) => mutant.status === 'Timeout' && mutant.statusReason === 'wall-clock-timeout')

const coversBothAttempts = (run: ObservedRun): boolean =>
  wallClockTimeoutsOf(run).every((mutant) => (run.recordedCostMs[mutant.id] ?? 0) >= 3 * MUTANT_BUDGET_MS)

const verdictClassOf = (run: ObservedRun) => Exit.isSuccess(run.exit) ? run.exit.value.verdict : undefined

Feature('Scoring a wall-clock expiry only when a confirmation expires too')
  .withLayer(Layer.empty)
  .live('the run spawns the vm worker and drives the real child-process test runner')
  .body(({ scenario }) => {
    scenario(
      'A mutant that never settles expires twice, is reported as a confirmed timeout, and the next run reuses it',
      Gherkin.Do.pipe(
        Given('a project whose module can be mutated so its promise never settles')(
          'workspace',
          () => writeWorkspace('never-settles').pipe(Effect.provide(filePorts)),
        ),
        When('two mutation runs execute with a short time budget for each mutant')(
          'observation',
          (s) => runTwiceAndClean(s.workspace),
        ),
        Then(
          'the first run finishes with the never-settling mutant timed out and its siblings classified, and the second run reuses that timeout instead of refusing it as unreproduced',
        )((s, expect) => {
          const { first, second } = s.observation
          return expect({
            firstRunCompleted: Exit.isSuccess(first.exit),
            firstVerdictReached: verdictOf(first.events) !== undefined,
            firstInternalError: verdictClassOf(first) === 'InternalError',
            firstWallClockTimeoutReported: wallClockTimeoutsOf(first).length >= 1,
            firstTimeoutStreamed: timeoutStreamed(first.events),
            firstVerdictCountsTimeout: (verdictOf(first.events)?.counts.timeout ?? 0) >= 1,
            siblingsStillClassified: first.daemonMutants.some((mutant) => mutant.status === 'Killed'),
            firstCostCoversBothAttempts: coversBothAttempts(first),
            secondRunCompleted: Exit.isSuccess(second.exit),
            secondRefusesUnreproducedTimeouts: reuseOf(second.events)?.refused.timeoutUnreproduced,
            secondRanNoMutant: reuseOf(second.events)?.ran,
            secondStillReportsTheTimeout: wallClockTimeoutsOf(second).length === wallClockTimeoutsOf(first).length,
          }).toEqual({
            firstRunCompleted: true,
            firstVerdictReached: true,
            firstInternalError: false,
            firstWallClockTimeoutReported: true,
            firstTimeoutStreamed: true,
            firstVerdictCountsTimeout: true,
            siblingsStillClassified: true,
            firstCostCoversBothAttempts: true,
            secondRunCompleted: true,
            secondRefusesUnreproducedTimeouts: 0,
            secondRanNoMutant: 0,
            secondStillReportsTheTimeout: true,
          })
        }),
      ),
    )

    scenario(
      'A mutant whose first run hangs and whose confirmation finishes is classified by its tests, not timed out',
      Gherkin.Do.pipe(
        Given('a project whose mutated branch hangs only the first time a run reaches it')(
          'workspace',
          () => writeWorkspace('hangs-once').pipe(Effect.provide(filePorts)),
        ),
        When('a mutation run executes with a short time budget for each mutant')(
          'observation',
          (s) => runOnceAndClean(s.workspace),
        ),
        Then('the run finishes, one attempt hung, and no mutant of the module is reported as timed out')(
          (s, expect) => {
            const { run, hangHappened } = s.observation
            return expect({
              runCompleted: Exit.isSuccess(run.exit),
              internalError: verdictClassOf(run) === 'InternalError',
              hangHappened,
              mutantsReported: run.daemonMutants.length > 0,
              timeouts: run.daemonMutants.filter((mutant) => mutant.status === 'Timeout').length,
              timeoutStreamed: timeoutStreamed(run.events),
            }).toEqual({
              runCompleted: true,
              internalError: false,
              hangHappened: true,
              mutantsReported: true,
              timeouts: 0,
              timeoutStreamed: false,
            })
          },
        ),
      ),
    )
  })
