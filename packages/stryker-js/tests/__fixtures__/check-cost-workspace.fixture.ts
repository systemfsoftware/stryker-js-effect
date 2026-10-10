import { NodeFileSystem, NodePath } from '@effect/platform-node'
import { Cli, Engine } from '@systemfsoftware/stryker-js'
import { RunEvent } from '@systemfsoftware/stryker-js-cli-contract'
import { type Options } from '@systemfsoftware/stryker-js-plugin-interface'
import { mergeConfig } from '@systemfsoftware/stryker-js/config'
import * as Arr from 'effect/Array'
import * as Cause from 'effect/Cause'
import * as Effect from 'effect/Effect'
import * as Exit from 'effect/Exit'
import * as FileSystem from 'effect/FileSystem'
import { dual } from 'effect/Function'
import * as Layer from 'effect/Layer'
import * as Option from 'effect/Option'
import * as Path from 'effect/Path'
import * as Queue from 'effect/Queue'
import * as S from 'effect/Schema'

const PACKAGE_ROOT = decodeURIComponent(new URL('../..', import.meta.url).pathname).replace(/\/$/, '')

const CHECKER_PLUGIN = new URL('./cost-checker/index.mjs', import.meta.url).href

export const REPORT_FILE = 'reports/main.json'

const COVERING_TEST_WALL_MS = 120

const REJECTED_SOURCE = [
  'export const hit = (value: number): number => value + 1',
  'export const miss = (value: number): number => value * 2',
  '',
].join('\n')

const IGNORED_SOURCE = 'export const skipped = (value: number): number => value + 1\n'

const KEPT_SOURCE = 'export const kept = (left: number, right: number): number => left * right + 1\n'

const UNREACHED_SOURCE = 'export const unreached = (value: number): number => value * 2\n'

const SLOW_TEST_SOURCE = [
  "import { expect, test } from 'vitest'",
  "import { hit } from '../src/lib/rejected.ts'",
  "import { kept } from '../src/lib/kept.ts'",
  '',
  "test('exercises the covered modules with wall time to spare', () => {",
  '  expect(hit(1)).toBe(2)',
  '  expect(kept(2, 3)).toBe(7)',
  `  const until = Date.now() + ${COVERING_TEST_WALL_MS}`,
  '  while (Date.now() < until) {}',
  '})',
  '',
].join('\n')

const FAST_TEST_SOURCE = [
  "import { expect, test } from 'vitest'",
  "import { kept } from '../src/lib/kept.ts'",
  '',
  "test('doubles what the kept module computes', () => {",
  '  expect(kept(2, 3)).toBe(7)',
  '})',
  '',
].join('\n')

export const checkedWorkspaceFiles: ReadonlyArray<readonly [string, string]> = [
  ['package.json', '{ "type": "commonjs" }\n'],
  ['src/lib/rejected.ts', REJECTED_SOURCE],
  ['src/lib/ignored.ts', IGNORED_SOURCE],
  ['src/lib/kept.ts', KEPT_SOURCE],
  ['src/lib/unreached.ts', UNREACHED_SOURCE],
  ['test/sample.test.mjs', SLOW_TEST_SOURCE],
]

export const uncheckedWorkspaceFiles: ReadonlyArray<readonly [string, string]> = [
  ['package.json', '{ "type": "commonjs" }\n'],
  ['src/lib/kept.ts', KEPT_SOURCE],
  ['src/lib/unreached.ts', UNREACHED_SOURCE],
  ['test/sample.test.mjs', FAST_TEST_SOURCE],
]

const REASONLESS_SOURCE = 'export const reasonless = (value: number): number => value - 1\n'

const reasonlessWorkspaceFiles: ReadonlyArray<readonly [string, string]> = [
  ['package.json', '{ "type": "commonjs" }\n'],
  ['src/lib/reasonless.ts', REASONLESS_SOURCE],
  ['test/sample.test.mjs', FAST_TEST_SOURCE],
  ['src/lib/kept.ts', KEPT_SOURCE],
]

export const filePorts = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer)

export interface RefusedRun {
  readonly failed: boolean
  readonly failure: string
}

export const runReasonlessWorkspace: Effect.Effect<RefusedRun> = Effect.gen(function*() {
  const root = yield* writeWorkspace(reasonlessWorkspaceFiles)
  const queue = yield* Queue.bounded<RunEvent.RunEvent, Cause.Done>(RunEvent.RunEvent.QUEUE_BOUND)
  const ports = Cli.platformLayer
  const runLayer = Layer.merge(Layer.provide(Engine.stage(environmentFor(root), queue), ports), ports)
  const exit = yield* Engine.mutationTestCell
    .run({ cliOptions: checkedOptionsOf(root), targetMutatePatterns: undefined })
    .pipe(Effect.provide(runLayer), Effect.scoped, Effect.exit, Effect.ensuring(removeWorkspace(root)))
  return Exit.match(exit, {
    onFailure: (cause) => ({ failed: true, failure: Cause.pretty(cause) }),
    onSuccess: () => ({ failed: false, failure: '' }),
  })
}).pipe(Effect.orDie, Effect.provide(filePorts))

export const PLAN_FILE = 'plan.json'

export const planWorkspaceFiles: ReadonlyArray<readonly [string, string]> = [
  ['package.json', '{ "type": "commonjs" }\n'],
  ['src/lib/rejected.ts', REJECTED_SOURCE],
  ['src/lib/ignored.ts', IGNORED_SOURCE],
  ['src/lib/kept.ts', KEPT_SOURCE],
  ['src/lib/unreached.ts', UNREACHED_SOURCE],
]

export const cliConfigTextOf = (directory: string): string =>
  `export default ${
    JSON.stringify(
      {
        testRunner: 'command',
        commandRunner: { command: 'true' },
        checkers: [{ plugin: CHECKER_PLUGIN }],
        testFiles: ['test/**/*.mjs'],
        mutate: ['src/**/*.ts'],
        coverageAnalysis: 'off',
        concurrency: 1,
        reporters: [],
        tempDirName: `.stryker-tmp-${directory.slice(directory.lastIndexOf('/') + 1)}`,
        cleanTempDir: 'always',
        incremental: true,
        incrementalFile: `${directory}/${REPORT_FILE}`,
      },
      null,
      2,
    )
  }\n`

const environmentFor = (directory: string): Engine.RunEnvironmentShape => ({
  runId: '01ARZ3NDEKTSV4RRFFQ69G5FAX',
  resolvedMode: { mode: 'machine', signal: 'flag', stdoutIsTTY: false },
  runStartedAt: 0,
  basePath: directory,
  builtinReporters: {},
  configOverlay: mergeConfig,
  allowConsoleColors: false,
})

const workspaceNameOf = (directory: string): string => directory.slice(directory.lastIndexOf('/') + 1)

export const checkedOptionsOf = (directory: string): Options.PartialStrykerOptions => ({
  testRunner: 'vm',
  plugins: [],
  reporters: [],
  checkers: [{ plugin: CHECKER_PLUGIN }],
  testFiles: ['test/**/*.mjs'],
  mutate: ['src/**/*.ts'],
  coverageAnalysis: 'perTest',
  concurrency: 1,
  tempDirName: `.stryker-tmp-${workspaceNameOf(directory)}`,
  cleanTempDir: 'always',
  incremental: true,
  incrementalFile: `${directory}/${REPORT_FILE}`,
})

export const uncheckedOptionsOf = (directory: string): Options.PartialStrykerOptions => ({
  ...checkedOptionsOf(directory),
  checkers: [],
})

export const writeWorkspace = (
  files: ReadonlyArray<readonly [string, string]>,
): Effect.Effect<string, never, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const root = yield* fs.realPath(yield* fs.makeTempDirectory({ prefix: 'stryker-check-cost-' }))
    yield* Effect.forEach(
      files,
      ([file, content]) =>
        Effect.gen(function*() {
          const target = path.join(root, file)
          yield* fs.makeDirectory(path.dirname(target), { recursive: true })
          yield* fs.writeFileString(target, content)
        }),
      { discard: true },
    )
    yield* fs.symlink(path.join(PACKAGE_ROOT, 'node_modules'), path.join(root, 'node_modules'))
    return root
  }).pipe(Effect.orDie)

export const removeWorkspace = (root: string): Effect.Effect<void, never, never> =>
  Effect.provide(
    Effect.orDie(Effect.flatMap(FileSystem.FileSystem, (fs) => fs.remove(root, { recursive: true, force: true }))),
    filePorts,
  )

export interface MutantCostEntry {
  readonly predictedMs: number
  readonly actualMs: number | null
  readonly coveringTests: number
}

export interface Observation {
  readonly costs: Readonly<Record<string, MutantCostEntry>>
  readonly statuses: Readonly<Record<string, string>>
  readonly idsByFile: Readonly<Record<string, readonly string[]>>
  readonly streamCosts: Readonly<Record<string, number>>
  readonly verdictBudget: RunEvent.Budget | null
}

export type ReportObservation = Pick<Observation, 'costs' | 'statuses' | 'idsByFile'>

const readReport = (text: string): ReportObservation =>
  Option.match(S.decodeOption(S.fromJsonString(Engine.IncrementalReportSchema))(text), {
    onNone: () => ({ costs: {}, statuses: {}, idsByFile: {} }),
    onSome: (report) => {
      const files = Object.entries(report.files)
      const mutants = files.flatMap(([, file]) => file.mutants)
      return {
        costs: report.costs,
        statuses: Object.fromEntries(mutants.map((mutant) => [mutant.id, mutant.status])),
        idsByFile: Object.fromEntries(files.map(([file, entry]) => [file, entry.mutants.map((mutant) => mutant.id)])),
      }
    },
  })

export const readReportIn = (
  directory: string,
): Effect.Effect<ReportObservation, never, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const text = yield* fs.readFileString(path.join(directory, REPORT_FILE)).pipe(Effect.orElseSucceed(() => ''))
    return readReport(text)
  }).pipe(Effect.orDie)

const streamCostsOf = (events: ReadonlyArray<RunEvent.RunEvent>): Readonly<Record<string, number>> =>
  Object.fromEntries(
    events.flatMap((event) =>
      S.is(RunEvent.RunMutantTested)(event) && event.cost !== null
        ? [[event.id, event.cost.fixedOverheadMs + event.cost.testBodyMs] as const]
        : []
    ),
  )

const verdictBudgetOf = (events: ReadonlyArray<RunEvent.RunEvent>): RunEvent.Budget | null =>
  Option.getOrNull(Option.map(Arr.findLast(events, S.is(RunEvent.VerdictReached)), (event) => event.budget))

const runEngineWith = (
  directory: string,
  options: Options.PartialStrykerOptions,
): Effect.Effect<Observation, never, never> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const queue = yield* Queue.bounded<RunEvent.RunEvent, Cause.Done>(RunEvent.RunEvent.QUEUE_BOUND)
    const ports = Cli.platformLayer
    const runLayer = Layer.merge(
      Layer.provide(Engine.stage(environmentFor(directory), queue), ports),
      ports,
    )
    yield* Engine.mutationTestCell
      .run({ cliOptions: options, targetMutatePatterns: undefined })
      .pipe(Effect.provide(runLayer), Effect.scoped, Effect.orDie)
    const events = yield* Queue.end(queue).pipe(
      Effect.andThen(Queue.takeAll(queue)),
      Effect.orElseSucceed((): ReadonlyArray<RunEvent.RunEvent> => []),
    )
    const text = yield* fs.readFileString(path.join(directory, REPORT_FILE)).pipe(Effect.orElseSucceed(() => ''))
    return { ...readReport(text), streamCosts: streamCostsOf(events), verdictBudget: verdictBudgetOf(events) }
  }).pipe(Effect.orDie, Effect.provide(filePorts))

export const runEngine: {
  (
    directory: string,
    options: Options.PartialStrykerOptions,
  ): Effect.Effect<Observation, never, never>
  (
    options: Options.PartialStrykerOptions,
  ): (directory: string) => Effect.Effect<Observation, never, never>
} = dual(2, runEngineWith)

const runWorkspaceWith = (
  files: ReadonlyArray<readonly [string, string]>,
  optionsOf: (directory: string) => Options.PartialStrykerOptions,
): Effect.Effect<Observation, never, never> =>
  Effect.gen(function*() {
    const root = yield* writeWorkspace(files)
    return yield* Effect.ensuring(runEngineWith(root, optionsOf(root)), removeWorkspace(root))
  }).pipe(Effect.orDie, Effect.provide(filePorts))

export const runWorkspace: {
  (
    files: ReadonlyArray<readonly [string, string]>,
    optionsOf: (directory: string) => Options.PartialStrykerOptions,
  ): Effect.Effect<Observation, never, never>
  (
    optionsOf: (directory: string) => Options.PartialStrykerOptions,
  ): (files: ReadonlyArray<readonly [string, string]>) => Effect.Effect<Observation, never, never>
} = dual(2, runWorkspaceWith)
