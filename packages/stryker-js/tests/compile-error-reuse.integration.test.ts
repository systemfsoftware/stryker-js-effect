import { NodeFileSystem, NodePath } from '@effect/platform-node'
import { Gherkin, Given, it, makeFeature, Then } from '@systemfsoftware/effect-gherkin-spec'
import { Engine } from '@systemfsoftware/stryker-js'
import { RunEvent } from '@systemfsoftware/stryker-js-cli-contract'
import type { Options } from '@systemfsoftware/stryker-js-plugin-interface'
import { mergeConfig } from '@systemfsoftware/stryker-js/config'
import * as Boolean from 'effect/Boolean'
import type * as Cause from 'effect/Cause'
import * as Console from 'effect/Console'
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

const CHECKER_PLUGIN = new URL('./__fixtures__/program-digesting-checker/index.mjs', import.meta.url).href

const SUBJECT_FILE = 'src/lib/subject.ts'
const CHAIN_FILE = 'src/lib/chain.ts'
const DECLARATION_FILE = 'src/types/transitive.d.ts'
const UNRELATED_TEST_FILE = 'test/unrelated.test.mjs'
const TSCONFIG_FILE = 'tsconfig.json'

const SUBJECT_SOURCE = [
  "import { shifted } from './chain.ts'",
  '',
  'export const doubled = (value: number): number => value * 2',
  'export const combined = (value: number): number => doubled(value) + shifted()',
  '',
].join('\n')

const CHAIN_SOURCE = [
  "import type { Offset } from '../types/transitive.d.ts'",
  '',
  'export const shifted = (): number => (1 as Offset) + 1',
  '',
].join('\n')

const DECLARATION_SOURCE = 'export type Offset = number\n'

const TEST_SOURCE = [
  "import { expect, test } from 'vitest'",
  "import { combined } from '../src/lib/subject.ts'",
  '',
  "test('loads the subject module without exercising it', () => {",
  "  expect(typeof combined).toBe('function')",
  '})',
  '',
].join('\n')

const UNRELATED_TEST_SOURCE = [
  "import { expect, test } from 'vitest'",
  '',
  "test('adds two numbers', () => {",
  '  expect(1 + 1).toBe(2)',
  '})',
  '',
].join('\n')

const TSCONFIG_SOURCE = JSON.stringify({ compilerOptions: { target: 'ES2022' }, include: ['src'] }, null, 2) + '\n'
const CHANGED_TSCONFIG_SOURCE = JSON.stringify(
  { compilerOptions: { target: 'ES2022', strict: false }, include: ['src'] },
  null,
  2,
) + '\n'

const BASE_TSCONFIG_FILE = 'tsconfig.base.json'
const BASE_TSCONFIG_SOURCE = JSON.stringify({ compilerOptions: { target: 'ES2022', strict: true } }, null, 2) + '\n'
const CHANGED_BASE_TSCONFIG_SOURCE = JSON.stringify({ compilerOptions: { target: 'ES2022', strict: false } }, null, 2) +
  '\n'
const EXTENDS_TSCONFIG_SOURCE = JSON.stringify(
  { extends: `./${BASE_TSCONFIG_FILE}`, compilerOptions: { target: 'ES2022' }, include: ['src'] },
  null,
  2,
) + '\n'

const VITEST_CONFIG_SOURCE = 'export default { test: { testTimeout: 600_000, hookTimeout: 600_000 } }\n'

interface Workspace {
  readonly directory: string
}

const REPORT_FILE = 'reports/main.json'

const incrementalFileOf = (directory: string): string => `${directory}/${REPORT_FILE}`

const DEFAULT_FILES: Readonly<Record<string, string>> = {
  'package.json': '{ "type": "commonjs" }\n',
  'vitest.config.ts': VITEST_CONFIG_SOURCE,
  [TSCONFIG_FILE]: TSCONFIG_SOURCE,
  [SUBJECT_FILE]: SUBJECT_SOURCE,
  [CHAIN_FILE]: CHAIN_SOURCE,
  [DECLARATION_FILE]: DECLARATION_SOURCE,
  'test/sample.test.mjs': TEST_SOURCE,
  [UNRELATED_TEST_FILE]: UNRELATED_TEST_SOURCE,
}

const CONFIG_FILE = 'stryker.config.mjs'

const configSourceOf = (directory: string): string =>
  `export default {
  testRunner: 'vm',
  plugins: [],
  reporters: [],
  checkers: [{ plugin: ${JSON.stringify(CHECKER_PLUGIN)} }],
  testFiles: ['test/**/*.mjs'],
  mutate: ['${SUBJECT_FILE}'],
  coverageAnalysis: 'perTest',
  cleanTempDir: 'always',
  incremental: true,
  incrementalFile: ${JSON.stringify(incrementalFileOf(directory))},
}
`

const configuredFilesOf = (directory: string): Readonly<Record<string, string>> => ({
  ...DEFAULT_FILES,
  [CONFIG_FILE]: configSourceOf(directory),
})

const withInPlace = (source: string): string =>
  source.replace('  incremental: true,', '  incremental: true,\n  inPlace: true,')

const inPlaceFilesOf = (directory: string, report: string): Readonly<Record<string, string>> => ({
  ...configuredFilesOf(directory),
  [CONFIG_FILE]: withInPlace(configSourceOf(directory)),
  [REPORT_FILE]: report,
})

const readIncrementalReport = (directory: string): Effect.Effect<string, never, never> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    return yield* fs.readFileString(incrementalFileOf(directory))
  }).pipe(Effect.orDie, Effect.provide(filePorts))

const materializeWorkspace = (
  directory: string,
  files: Readonly<Record<string, string>>,
): Effect.Effect<Workspace, never, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    yield* Effect.forEach(
      Object.entries(files),
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

const writeWorkspace = (
  files: Readonly<Record<string, string>> = DEFAULT_FILES,
): Effect.Effect<Workspace, never, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const directory = yield* fs.makeTempDirectory()
    return yield* materializeWorkspace(directory, files)
  }).pipe(Effect.orDie)

const removeWorkspace = (directory: string): Effect.Effect<void, never, FileSystem.FileSystem> =>
  Effect.orDie(
    Effect.flatMap(FileSystem.FileSystem, (fs) => fs.remove(directory, { recursive: true, force: true })),
  )

const rewriteFile = (directory: string, file: string, content: string): Effect.Effect<void, never, never> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    yield* fs.writeFileString(`${directory}/${file}`, content)
  }).pipe(Effect.orDie, Effect.provide(filePorts))

const appendComment = (directory: string, file: string): Effect.Effect<void, never, never> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const target = path.join(directory, file)
    const text = yield* fs.readFileString(target)
    yield* fs.writeFileString(target, `${text}\n// edited between runs\n`)
  }).pipe(Effect.orDie, Effect.provide(filePorts))

const environmentFor = (directory: string): Engine.RunEnvironmentShape => ({
  runId: '01ARZ3NDEKTSV4RRFFQ69G5FAX',
  resolvedMode: { mode: 'machine', signal: 'flag', stdoutIsTTY: false },
  runStartedAt: 0,
  basePath: directory,
  builtinReporters: {},
  configOverlay: mergeConfig,
  allowConsoleColors: false,
})

interface MutantRow {
  readonly id: string
  readonly status: string
  readonly statusReason?: string | undefined
  readonly programDigest?: string | undefined
  readonly line?: number | undefined
}

interface ReuseObservation {
  readonly exit: Exit.Exit<Engine.MutationTestDone, Engine.StageError>
  readonly reuse: RunEvent.ReuseReported | undefined
  readonly mutants: readonly MutantRow[]
  readonly incrementalText: string
  readonly testRunnerStartups: number
  readonly dryRunTestRunners: number
}

const startupsOf = (events: ReadonlyArray<RunEvent.RunEvent>, role: RunEvent.WorkerRole): number =>
  events.filter((event) => S.is(RunEvent.WorkerReported)(event) && event.role === role).length

const beforeMutationTesting = (events: ReadonlyArray<RunEvent.RunEvent>): ReadonlyArray<RunEvent.RunEvent> => {
  const entered = events.findIndex((event) => S.is(RunEvent.PhaseEntered)(event) && event.phase === 'mutation-test')
  return entered === -1 ? events : events.slice(0, entered)
}

const rowsOf = (text: string): readonly MutantRow[] => {
  const rowSchema = S.Struct({
    id: S.String,
    status: S.String,
    statusReason: S.optional(S.String),
    programDigest: S.optional(S.String),
    location: S.optional(S.Struct({ start: S.Struct({ line: S.Finite }) })),
  })
  const reportSchema = S.Struct({
    files: S.Record(S.String, S.Struct({ mutants: S.Array(rowSchema) })),
  })
  return Option.getOrElse(
    Option.map(
      S.decodeOption(S.fromJsonString(reportSchema))(text),
      (report) =>
        Object.values(report.files).flatMap((file) =>
          file.mutants.map(({ location, ...row }) => ({ ...row, line: location?.start.line }))
        ),
    ),
    (): readonly MutantRow[] => [],
  )
}

const DEFAULT_RUN_CLI_OPTIONS: Options.PartialStrykerOptions = {
  testRunner: 'vm',
  plugins: [],
  reporters: [],
  checkers: [{ plugin: CHECKER_PLUGIN }],
  testFiles: ['test/**/*.mjs'],
  mutate: [SUBJECT_FILE],
  coverageAnalysis: 'perTest',
  cleanTempDir: 'always',
  incremental: true,
}

const runCliOptionsOf = (workspace: Workspace): Options.PartialStrykerOptions => ({
  ...DEFAULT_RUN_CLI_OPTIONS,
  incrementalFile: incrementalFileOf(workspace.directory),
})

const executeRunWith = (
  workspace: Workspace,
  cliOptions: Options.PartialStrykerOptions,
): Effect.Effect<ReuseObservation, never, never> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const queue = yield* Queue.bounded<RunEvent.RunEvent, Cause.Done>(RunEvent.RunEvent.QUEUE_BOUND)
    const runLayer = Layer.merge(
      Layer.provide(Engine.stage(environmentFor(workspace.directory), queue), Engine.nodePlatformLayer),
      Engine.nodePlatformLayer,
    )
    const exit = yield* Engine.mutationTestCell
      .run({ cliOptions, targetMutatePatterns: undefined })
      .pipe(Effect.provide(runLayer), Effect.scoped, Effect.exit)
    const events = [
      ...(yield* Queue.takeAll(queue).pipe(
        Effect.orElseSucceed((): ReadonlyArray<RunEvent.RunEvent> => []),
      )),
    ]
    const incrementalText = yield* fs.readFileString(incrementalFileOf(workspace.directory)).pipe(
      Effect.orElseSucceed(() => ''),
    )
    return {
      exit,
      reuse: events.find((event): event is RunEvent.ReuseReported => S.is(RunEvent.ReuseReported)(event)),
      mutants: rowsOf(incrementalText),
      incrementalText,
      testRunnerStartups: startupsOf(events, 'testRunner'),
      dryRunTestRunners: startupsOf(beforeMutationTesting(events), 'testRunner'),
    }
  }).pipe(Effect.provide(filePorts))

const executeRun = (workspace: Workspace): Effect.Effect<ReuseObservation, never, never> =>
  executeRunWith(workspace, runCliOptionsOf(workspace))

const withChdir = <A, E, R>(directory: string, effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
  Effect.acquireUseRelease(
    Effect.sync(() => {
      const previous = globalThis.process.cwd()
      globalThis.process.chdir(directory)
      return previous
    }),
    () => effect,
    (previous) => Effect.sync(() => globalThis.process.chdir(previous)),
  )

const executeConfiguredRun = (workspace: Workspace): Effect.Effect<ReuseObservation, never, never> =>
  withChdir(workspace.directory, executeRunWith(workspace, {}))

interface PlanObservation {
  readonly total: number
  readonly reused: number
  readonly ran: number
  readonly programChanged: number
  readonly checkerStartups: readonly number[]
}

const PLAN_REQUEST = {
  targetSeconds: 1,
  maxShards: 4,
  projects: ['.'],
  out: 'plan.json',
  full: false,
} satisfies Engine.PlanRequestInput['request']

const executePlan = (workspace: Workspace): Effect.Effect<PlanObservation, never, never> =>
  withChdir(
    workspace.directory,
    Effect.gen(function*() {
      const queue = yield* Queue.bounded<RunEvent.RunEvent, Cause.Done>(RunEvent.RunEvent.QUEUE_BOUND)
      const consoleService = yield* Console.Console
      yield* Engine.planRequest({
        request: PLAN_REQUEST,
        channel: {
          environment: {
            basePath: workspace.directory,
            host: { env: environmentFor(workspace.directory), events: queue },
            console: consoleService,
          },
        },
      }).pipe(Effect.provide(Engine.nodePlatformLayer))
      const events = [
        ...(yield* Queue.takeAll(queue).pipe(
          Effect.orElseSucceed((): ReadonlyArray<RunEvent.RunEvent> => []),
        )),
      ]
      const plan = Option.getOrThrowWith(
        Option.fromUndefinedOr(events.find((event): event is RunEvent.PlanKnown => S.is(RunEvent.PlanKnown)(event))),
        () => new Error('the plan emitted no PlanKnown event'),
      )
      const projects = Option.getOrElse(
        Option.fromUndefinedOr(plan.projects),
        (): ReadonlyArray<RunEvent.PlanProjectReuse> => [],
      )
      return {
        total: plan.total,
        reused: projects.reduce((sum, project) => sum + project.reused, 0),
        ran: projects.reduce((sum, project) => sum + project.ran, 0),
        programChanged: projects.reduce((sum, project) => sum + (project.refused.programChanged ?? 0), 0),
        checkerStartups: events.flatMap((event) =>
          Option.match(Option.liftPredicate(event, S.is(RunEvent.WorkerReported)), {
            onNone: (): readonly number[] => [],
            onSome: (reported) =>
              Boolean.match(reported.role === 'checker', {
                onTrue: (): readonly number[] => [reported.startupMs],
                onFalse: (): readonly number[] => [],
              }),
          })
        ),
      }
    }).pipe(Effect.provide(filePorts)),
  )

interface TwoRuns {
  readonly first: ReuseObservation
  readonly second: ReuseObservation
}

const runTwice = (
  workspace: Workspace,
  between: (workspace: Workspace) => Effect.Effect<void, never, never>,
): Effect.Effect<TwoRuns, never, never> =>
  Effect.gen(function*() {
    const first = yield* executeRun(workspace)
    yield* between(workspace)
    const second = yield* executeRun(workspace)
    return { first, second }
  })

const withWorkspace = <A>(
  use: (workspace: Workspace) => Effect.Effect<A, never, never>,
  files?: Readonly<Record<string, string>>,
): Effect.Effect<A, never, never> =>
  Effect.gen(function*() {
    const workspace = yield* writeWorkspace(files)
    return yield* use(workspace).pipe(Effect.ensuring(removeWorkspace(workspace.directory)))
  }).pipe(Effect.orDie, Effect.provide(filePorts))

const withConfiguredWorkspaceOf = <A>(
  filesOf: (directory: string) => Readonly<Record<string, string>>,
  use: (workspace: Workspace) => Effect.Effect<A, never, never>,
): Effect.Effect<A, never, never> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const directory = yield* fs.makeTempDirectory()
    const workspace = yield* materializeWorkspace(directory, filesOf(directory))
    return yield* use(workspace).pipe(Effect.ensuring(removeWorkspace(workspace.directory)))
  }).pipe(Effect.orDie, Effect.provide(filePorts))

const withConfiguredWorkspace = <A>(
  use: (workspace: Workspace) => Effect.Effect<A, never, never>,
): Effect.Effect<A, never, never> => withConfiguredWorkspaceOf(configuredFilesOf, use)

const compileErrorRows = (rows: readonly MutantRow[]): readonly MutantRow[] =>
  rows.filter((row) => row.status === 'CompileError')

const digestCountOf = (rows: readonly MutantRow[]): number =>
  compileErrorRows(rows).filter((row) => (row.programDigest ?? '').length > 0).length

const ranOf = (observation: ReuseObservation): number => observation.reuse?.ran ?? -1

const reusedOf = (observation: ReuseObservation): number => observation.reuse?.reused ?? -1

const programChangedOf = (observation: ReuseObservation): number => observation.reuse?.refused.programChanged ?? -1

const OTHER_FILE = 'src/lib/other.ts'

const OTHER_SOURCE = 'export const tripled = (value: number): number => value * 3\n'

const OTHER_TEST_SOURCE = [
  "import { expect, test } from 'vitest'",
  "import { tripled } from '../src/lib/other.ts'",
  '',
  "test('triples a number', () => {",
  '  expect(tripled(2)).toBe(6)',
  '})',
  '',
].join('\n')

const ACCEPT_ALL_CHAIN_SOURCE = `${CHAIN_SOURCE}// checker-accepts-all\n`

const DOUBLED_LINE = 3

const DISABLED_DOUBLED_SUBJECT_SOURCE = SUBJECT_SOURCE.replace(
  'export const doubled',
  '// Stryker disable next-line all: settled before any check\nexport const doubled',
)

const twoModuleFilesOf = (directory: string): Readonly<Record<string, string>> => ({
  ...configuredFilesOf(directory),
  [OTHER_FILE]: OTHER_SOURCE,
  'test/other.test.mjs': OTHER_TEST_SOURCE,
  [CONFIG_FILE]: configSourceOf(directory).replace(
    `mutate: ['${SUBJECT_FILE}'],`,
    `mutate: ['${SUBJECT_FILE}', '${OTHER_FILE}'],`,
  ),
})

const executeConfiguredRunWith = (
  workspace: Workspace,
  cliOptions: Options.PartialStrykerOptions & { readonly mutantIds?: ReadonlyArray<string> },
): Effect.Effect<ReuseObservation, never, never> =>
  withChdir(workspace.directory, executeRunWith(workspace, cliOptions))

const idsOf = (rows: readonly MutantRow[]): readonly string[] => rows.map((row) => row.id)

const statusesOf = (rows: readonly MutantRow[], ids: readonly string[]): Readonly<Record<string, string>> =>
  Object.fromEntries(rows.filter((row) => ids.includes(row.id)).map((row) => [row.id, row.status]))

const verdictsOf = (rows: readonly MutantRow[], ids: readonly string[]): Readonly<Record<string, string>> =>
  Object.fromEntries(
    rows.filter((row) => ids.includes(row.id)).map((row) => [row.id, `${row.status}: ${row.statusReason ?? ''}`]),
  )

const testedIdsOf = (rows: readonly MutantRow[]): readonly string[] =>
  idsOf(rows.filter((row) => row.status !== 'CompileError'))

const onLineOf = (rows: readonly MutantRow[], line: number): readonly string[] =>
  idsOf(rows.filter((row) => row.line === line))

const everyStatusOf = (ids: readonly string[], status: string): Readonly<Record<string, string>> =>
  Object.fromEntries(ids.map((id) => [id, status]))

Feature('Reusing CompileError verdicts across incremental runs', { timeout: 240_000 })
  .withLayer(Layer.empty)
  .live('the run keys every CompileError verdict by the program the checker loaded')
  .body(({ scenario }) => {
    scenario(
      'an unchanged rerun reuses the CompileError verdicts and checks nothing',
      Gherkin.Do.pipe(
        Given('a project whose checker rejects every mutant of a module and digests its loaded program')(
          'runs',
          () => withWorkspace((workspace) => runTwice(workspace, () => Effect.void)),
        ),
        Then(
          'the first run stamped every CompileError verdict with a program digest and the second run reused them all without a check',
        )((s, expect) =>
          expect({
            firstCompileErrors: compileErrorRows(s.runs.first.mutants).length > 0,
            firstDigestsStamped: digestCountOf(s.runs.first.mutants) ===
              compileErrorRows(s.runs.first.mutants).length,
            secondSucceeded: Exit.isSuccess(s.runs.second.exit),
            secondReusedAll: reusedOf(s.runs.second) === s.runs.first.mutants.length,
            secondRanNothing: ranOf(s.runs.second),
            secondRefusals: programChangedOf(s.runs.second),
          }).toEqual({
            firstCompileErrors: true,
            firstDigestsStamped: true,
            secondSucceeded: true,
            secondReusedAll: true,
            secondRanNothing: 0,
            secondRefusals: 0,
          })
        ),
      ),
    )

    scenario(
      'editing a declaration the mutated module only reaches transitively re-checks every CompileError',
      Gherkin.Do.pipe(
        Given('a project whose checker digests a declaration reached through another module')(
          'runs',
          () =>
            withWorkspace((workspace) =>
              runTwice(workspace, (inner) => appendComment(inner.directory, DECLARATION_FILE))
            ),
        ),
        Then('the second run refuses the remembered verdicts naming the changed program')((s, expect) =>
          expect({
            firstCompileErrors: compileErrorRows(s.runs.first.mutants).length > 0,
            secondSucceeded: Exit.isSuccess(s.runs.second.exit),
            secondRanChecks: ranOf(s.runs.second) > 0,
            secondRefusedForProgram: programChangedOf(s.runs.second) > 0,
            secondRecheckedStatuses: compileErrorRows(s.runs.second.mutants).length,
          }).toEqual({
            firstCompileErrors: true,
            secondSucceeded: true,
            secondRanChecks: true,
            secondRefusedForProgram: true,
            secondRecheckedStatuses: compileErrorRows(s.runs.first.mutants).length,
          })
        ),
      ),
    )

    scenario(
      'changing tsconfig re-checks every CompileError',
      Gherkin.Do.pipe(
        Given('a project whose checker digests its tsconfig')(
          'runs',
          () =>
            withWorkspace((workspace) =>
              runTwice(workspace, (inner) => rewriteFile(inner.directory, TSCONFIG_FILE, CHANGED_TSCONFIG_SOURCE))
            ),
        ),
        Then('the second run refuses the remembered verdicts naming the changed program')((s, expect) =>
          expect({
            firstCompileErrors: compileErrorRows(s.runs.first.mutants).length > 0,
            secondSucceeded: Exit.isSuccess(s.runs.second.exit),
            secondRanChecks: ranOf(s.runs.second) > 0,
            secondRefusedForProgram: programChangedOf(s.runs.second) > 0,
          }).toEqual({
            firstCompileErrors: true,
            secondSucceeded: true,
            secondRanChecks: true,
            secondRefusedForProgram: true,
          })
        ),
      ),
    )

    scenario(
      'editing a test file outside the checker program keeps every CompileError remembered',
      Gherkin.Do.pipe(
        Given('a project whose checker does not digest the unrelated test file')(
          'runs',
          () =>
            withWorkspace((workspace) =>
              runTwice(
                workspace,
                (inner) =>
                  rewriteFile(inner.directory, UNRELATED_TEST_FILE, `${UNRELATED_TEST_SOURCE}// edited between runs\n`),
              )
            ),
        ),
        Then('the second run still reuses every CompileError verdict')((s, expect) =>
          expect({
            firstCompileErrors: compileErrorRows(s.runs.first.mutants).length > 0,
            secondSucceeded: Exit.isSuccess(s.runs.second.exit),
            secondRanNothing: ranOf(s.runs.second),
            secondReusedAll: reusedOf(s.runs.second) === s.runs.first.mutants.length,
            secondProgramRefusals: programChangedOf(s.runs.second),
          }).toEqual({
            firstCompileErrors: true,
            secondSucceeded: true,
            secondRanNothing: 0,
            secondReusedAll: true,
            secondProgramRefusals: 0,
          })
        ),
      ),
    )

    scenario(
      'editing only a base tsconfig the root extends re-checks every CompileError',
      Gherkin.Do.pipe(
        Given('a project whose root tsconfig extends a base holding its compiler options')(
          'runs',
          () =>
            withWorkspace(
              (workspace) =>
                runTwice(workspace, (inner) =>
                  rewriteFile(inner.directory, BASE_TSCONFIG_FILE, CHANGED_BASE_TSCONFIG_SOURCE)),
              {
                ...DEFAULT_FILES,
                [TSCONFIG_FILE]: EXTENDS_TSCONFIG_SOURCE,
                [BASE_TSCONFIG_FILE]: BASE_TSCONFIG_SOURCE,
              },
            ),
        ),
        Then('the second run refuses the remembered verdicts naming the changed program')((s, expect) =>
          expect({
            firstCompileErrors: compileErrorRows(s.runs.first.mutants).length > 0,
            secondSucceeded: Exit.isSuccess(s.runs.second.exit),
            secondRanChecks: ranOf(s.runs.second) > 0,
            secondRefusedForProgram: programChangedOf(s.runs.second) > 0,
          }).toEqual({
            firstCompileErrors: true,
            secondSucceeded: true,
            secondRanChecks: true,
            secondRefusedForProgram: true,
          })
        ),
      ),
    )

    scenario(
      'an unchanged program lets the plan and the run reuse every CompileError without starting a checker',
      Gherkin.Do.pipe(
        Given('a configured project whose checker digests its program and rejects one module')(
          'runs',
          () =>
            withConfiguredWorkspace((workspace) =>
              Effect.gen(function*() {
                const coldPlan = yield* executePlan(workspace)
                const first = yield* executeConfiguredRun(workspace)
                const warmPlan = yield* executePlan(workspace)
                const second = yield* executeConfiguredRun(workspace)
                return { coldPlan, first, warmPlan, second }
              })
            ),
        ),
        Then('the cold plan schedules everything without a checker and the warm plan schedules nothing')((s, expect) =>
          expect({
            firstCompileErrors: compileErrorRows(s.runs.first.mutants).length > 0,
            firstDigestsStamped: digestCountOf(s.runs.first.mutants) ===
              compileErrorRows(s.runs.first.mutants).length,
            coldScheduled: s.runs.coldPlan.total,
            coldCheckerStartups: s.runs.coldPlan.checkerStartups.length,
            warmCheckerStartups: s.runs.warmPlan.checkerStartups.length,
            warmReused: s.runs.warmPlan.reused,
            warmRan: s.runs.warmPlan.ran,
            warmProgramChanged: s.runs.warmPlan.programChanged,
            secondReusedAll: reusedOf(s.runs.second) === s.runs.first.mutants.length,
            secondRanNothing: ranOf(s.runs.second),
          }).toEqual({
            firstCompileErrors: true,
            firstDigestsStamped: true,
            coldScheduled: s.runs.first.mutants.length,
            coldCheckerStartups: 0,
            warmCheckerStartups: 1,
            warmReused: s.runs.first.mutants.length,
            warmRan: 0,
            warmProgramChanged: 0,
            secondReusedAll: true,
            secondRanNothing: 0,
          })
        ),
      ),
    )

    scenario(
      'editing a program file makes the plan and the run re-score every CompileError',
      Gherkin.Do.pipe(
        Given('a configured project whose checker digests a module the mutated module reaches')(
          'runs',
          () =>
            withConfiguredWorkspace((workspace) =>
              Effect.gen(function*() {
                const first = yield* executeConfiguredRun(workspace)
                yield* appendComment(workspace.directory, CHAIN_FILE)
                const plan = yield* executePlan(workspace)
                const second = yield* executeConfiguredRun(workspace)
                return { first, plan, second }
              })
            ),
        ),
        Then('the plan schedules every CompileError naming the changed program and the run re-scores them')(
          (s, expect) =>
            expect({
              firstCompileErrors: compileErrorRows(s.runs.first.mutants).length > 0,
              planScheduled: s.runs.plan.total,
              planCheckerStartups: s.runs.plan.checkerStartups.length,
              planProgramChanged: s.runs.plan.programChanged,
              planRan: s.runs.plan.ran,
              secondProgramChanged: programChangedOf(s.runs.second) > 0,
              secondRanChecks: ranOf(s.runs.second) > 0,
            }).toEqual({
              firstCompileErrors: true,
              planScheduled: s.runs.first.mutants.length,
              planCheckerStartups: 1,
              planProgramChanged: s.runs.first.mutants.length,
              planRan: s.runs.first.mutants.length,
              secondProgramChanged: true,
              secondRanChecks: true,
            }),
        ),
      ),
    )

    scenario(
      'an in-place plan starts no checker over the originals',
      Gherkin.Do.pipe(
        Given('a configured project whose checker digests its program and rejects one module')(
          'runs',
          () =>
            withConfiguredWorkspace((producer) =>
              Effect.gen(function*() {
                const first = yield* executeConfiguredRun(producer)
                const report = yield* readIncrementalReport(producer.directory)
                return yield* withConfiguredWorkspaceOf(
                  (directory) => inPlaceFilesOf(directory, report),
                  (inPlace) =>
                    Effect.gen(function*() {
                      const plan = yield* executePlan(inPlace)
                      return { first, plan }
                    }),
                )
              })
            ),
        ),
        Then('the in-place plan starts no checker')((s, expect) =>
          expect({
            firstCompileErrors: compileErrorRows(s.runs.first.mutants).length > 0,
            inPlacePlanCheckerStartups: s.runs.plan.checkerStartups.length,
          }).toEqual({
            firstCompileErrors: true,
            inPlacePlanCheckerStartups: 0,
          })
        ),
      ),
    )

    scenario(
      'a shard leaf holding only remembered CompileErrors of a changed program starts no test runner',
      Gherkin.Do.pipe(
        Given('a configured project with one module the checker rejects and one it accepts')(
          'runs',
          () =>
            withConfiguredWorkspaceOf(twoModuleFilesOf, (workspace) =>
              Effect.gen(function*() {
                const first = yield* executeConfiguredRun(workspace)
                const unchanged = yield* executeConfiguredRun(workspace)
                const compileErrorIds = idsOf(compileErrorRows(first.mutants))
                const testedIds = testedIdsOf(first.mutants)
                yield* appendComment(workspace.directory, CHAIN_FILE)
                const checkerOnly = yield* executeConfiguredRunWith(workspace, { mutantIds: compileErrorIds })
                const tested = yield* executeConfiguredRunWith(workspace, { mutantIds: testedIds.slice(0, 1) })
                return { first, unchanged, compileErrorIds, testedIds, checkerOnly, tested }
              })),
        ),
        Then(
          'the checker-only leaf scores every CompileError as the tested first run did without a test runner, and the leaf holding a tested mutant runs the initial test run',
        )((s, expect) =>
          expect({
            firstHasBothKinds: s.runs.compileErrorIds.length > 0 && s.runs.testedIds.length > 0,
            unchangedVerdicts: statusesOf(s.runs.unchanged.mutants, idsOf(s.runs.first.mutants)),
            checkerOnlySucceeded: Exit.isSuccess(s.runs.checkerOnly.exit),
            checkerOnlyTestRunners: s.runs.checkerOnly.testRunnerStartups,
            checkerOnlyVerdicts: verdictsOf(s.runs.checkerOnly.mutants, s.runs.compileErrorIds),
            testedSucceeded: Exit.isSuccess(s.runs.tested.exit),
            testedRanTheDryRun: s.runs.tested.dryRunTestRunners > 0,
          }).toEqual({
            firstHasBothKinds: true,
            unchangedVerdicts: statusesOf(s.runs.first.mutants, idsOf(s.runs.first.mutants)),
            checkerOnlySucceeded: true,
            checkerOnlyTestRunners: 0,
            checkerOnlyVerdicts: verdictsOf(s.runs.first.mutants, s.runs.compileErrorIds),
            testedSucceeded: true,
            testedRanTheDryRun: true,
          })
        ),
      ),
    )

    scenario(
      'a checker that now accepts a remembered CompileError runs the initial test run and scores it as a forced run does',
      Gherkin.Do.pipe(
        Given('a configured project whose checker rejected a module and now accepts it')(
          'runs',
          () =>
            withConfiguredWorkspace((workspace) =>
              Effect.gen(function*() {
                const first = yield* executeConfiguredRun(workspace)
                const compileErrorIds = idsOf(compileErrorRows(first.mutants))
                yield* rewriteFile(workspace.directory, CHAIN_FILE, ACCEPT_ALL_CHAIN_SOURCE)
                const accepted = yield* executeConfiguredRunWith(workspace, { mutantIds: compileErrorIds })
                const forced = yield* executeConfiguredRunWith(workspace, { mutantIds: compileErrorIds, force: true })
                return { compileErrorIds, accepted, forced }
              })
            ),
        ),
        Then('the run runs the initial test run and scores every accepted mutant as the forced run does')((s, expect) =>
          expect({
            hadCompileErrors: s.runs.compileErrorIds.length > 0,
            acceptedSucceeded: Exit.isSuccess(s.runs.accepted.exit),
            acceptedRanTheDryRun: s.runs.accepted.dryRunTestRunners > 0,
            acceptedCompileErrors: compileErrorRows(s.runs.accepted.mutants).length,
            acceptedVerdicts: verdictsOf(s.runs.accepted.mutants, s.runs.compileErrorIds),
          }).toEqual({
            hadCompileErrors: true,
            acceptedSucceeded: true,
            acceptedRanTheDryRun: true,
            acceptedCompileErrors: 0,
            acceptedVerdicts: verdictsOf(s.runs.forced.mutants, s.runs.compileErrorIds),
          })
        ),
      ),
    )

    scenario(
      'a deferred shard that also holds an already-settled mutant runs the initial test run',
      Gherkin.Do.pipe(
        Given('a configured project whose checker rejected a module, one line of which is now disabled')(
          'runs',
          () =>
            withConfiguredWorkspace((workspace) =>
              Effect.gen(function*() {
                const first = yield* executeConfiguredRun(workspace)
                const compileErrorIds = idsOf(compileErrorRows(first.mutants))
                const disabledIds = onLineOf(first.mutants, DOUBLED_LINE)
                yield* rewriteFile(workspace.directory, SUBJECT_FILE, DISABLED_DOUBLED_SUBJECT_SOURCE)
                const deferred = yield* executeConfiguredRunWith(workspace, { mutantIds: compileErrorIds })
                const forced = yield* executeConfiguredRunWith(workspace, { mutantIds: compileErrorIds, force: true })
                return { first, compileErrorIds, disabledIds, deferred, forced }
              })
            ),
        ),
        Then(
          'the shard runs the initial test run, the disabled mutants end Ignored, and every verdict matches a forced run',
        )(
          (s, expect) =>
            expect({
              everyPriorACompileError: s.runs.compileErrorIds.length === s.runs.first.mutants.length,
              hasDisabledMutants: s.runs.disabledIds.length > 0,
              deferredSucceeded: Exit.isSuccess(s.runs.deferred.exit),
              deferredRanTheDryRun: s.runs.deferred.dryRunTestRunners > 0,
              disabledStatuses: statusesOf(s.runs.deferred.mutants, s.runs.disabledIds),
              deferredVerdicts: verdictsOf(s.runs.deferred.mutants, s.runs.compileErrorIds),
            }).toEqual({
              everyPriorACompileError: true,
              hasDisabledMutants: true,
              deferredSucceeded: true,
              deferredRanTheDryRun: true,
              disabledStatuses: everyStatusOf(s.runs.disabledIds, 'Ignored'),
              deferredVerdicts: verdictsOf(s.runs.forced.mutants, s.runs.compileErrorIds),
            }),
        ),
      ),
    )
  })
