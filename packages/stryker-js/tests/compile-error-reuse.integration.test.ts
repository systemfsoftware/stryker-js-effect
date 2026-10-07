import { NodeFileSystem, NodePath } from '@effect/platform-node'
import { Gherkin, Given, it, makeFeature, Then } from '@systemfsoftware/effect-gherkin-spec'
import { Engine } from '@systemfsoftware/stryker-js'
import { RunEvent } from '@systemfsoftware/stryker-js-cli-contract'
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

const incrementalFileOf = (directory: string): string => `${directory}/reports/main.json`

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

const writeWorkspace = (
  files: Readonly<Record<string, string>> = DEFAULT_FILES,
): Effect.Effect<Workspace, never, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const directory = yield* fs.makeTempDirectory()
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
  allowConsoleColors: false,
})

interface MutantRow {
  readonly id: string
  readonly status: string
  readonly programDigest?: string | undefined
}

interface ReuseObservation {
  readonly exit: Exit.Exit<Engine.MutationTestDone, Engine.StageError>
  readonly reuse: RunEvent.ReuseReported | undefined
  readonly mutants: readonly MutantRow[]
  readonly incrementalText: string
}

const rowsOf = (text: string): readonly MutantRow[] => {
  const rowSchema = S.Struct({
    id: S.String,
    status: S.String,
    programDigest: S.optional(S.String),
  })
  const reportSchema = S.Struct({
    files: S.Record(S.String, S.Struct({ mutants: S.Array(rowSchema) })),
  })
  return Option.getOrElse(
    Option.map(
      S.decodeOption(S.fromJsonString(reportSchema))(text),
      (report) => Object.values(report.files).flatMap((file) => file.mutants),
    ),
    (): readonly MutantRow[] => [],
  )
}

const executeRun = (workspace: Workspace): Effect.Effect<ReuseObservation, never, never> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const queue = yield* Queue.bounded<RunEvent.RunEvent, Cause.Done>(RunEvent.RunEvent.QUEUE_BOUND)
    const runLayer = Layer.merge(
      Layer.provide(Engine.RunEnvironment.stage(environmentFor(workspace.directory), queue), Engine.nodePlatformLayer),
      Engine.nodePlatformLayer,
    )
    const exit = yield* Engine.mutationTestCell
      .run({
        cliOptions: {
          testRunner: 'vm',
          plugins: [],
          reporters: [],
          checkers: [{ plugin: CHECKER_PLUGIN }],
          testFiles: ['test/**/*.mjs'],
          mutate: [SUBJECT_FILE],
          coverageAnalysis: 'perTest',
          cleanTempDir: 'always',
          incremental: true,
          incrementalFile: incrementalFileOf(workspace.directory),
        },
        targetMutatePatterns: undefined,
      })
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
    }
  }).pipe(Effect.provide(filePorts))

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

const compileErrorRows = (rows: readonly MutantRow[]): readonly MutantRow[] =>
  rows.filter((row) => row.status === 'CompileError')

const digestCountOf = (rows: readonly MutantRow[]): number =>
  compileErrorRows(rows).filter((row) => (row.programDigest ?? '').length > 0).length

const ranOf = (observation: ReuseObservation): number => observation.reuse?.ran ?? -1

const reusedOf = (observation: ReuseObservation): number => observation.reuse?.reused ?? -1

const programChangedOf = (observation: ReuseObservation): number => observation.reuse?.refused.programChanged ?? -1

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
  })
