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
import * as Option from 'effect/Option'
import * as Path from 'effect/Path'
import * as Queue from 'effect/Queue'
import * as S from 'effect/Schema'

const Feature = makeFeature({ it })

const FRAMEWORK_FIXTURES = `${globalThis.process.cwd()}/tests/__fixtures__/frameworks`

const pluginUrlOf = (moduleName: string): string =>
  globalThis.process.getBuiltinModule('node:url').pathToFileURL(`${FRAMEWORK_FIXTURES}/${moduleName}`).href

const filePorts = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer)

const MATH_FILE = 'src/lib/math.ts'
const FIXTURE_FILE = 'src/widget.fixture'

const MATH_SOURCE = 'export const incrementBy = (value: number, step: number): number => value + step\n' +
  '\nexport const toggleValue = (value: boolean): boolean => !value\n'

const FIXTURE_SOURCE = '<script>function add(a, b) { return a + b; }</script>\n'

const SOURCES: Readonly<Record<string, string>> = {
  [MATH_FILE]: MATH_SOURCE,
  [FIXTURE_FILE]: FIXTURE_SOURCE,
}

const PACKAGE_SOURCE = '{ "type": "commonjs" }\n'
const TEST_SOURCE = [
  "import { expect, test } from 'vitest'",
  "import { incrementBy, toggleValue } from '../src/lib/math.ts'",
  '',
  "test('the workspace test suite exercises the mutated module', () => {",
  '  expect({ sum: incrementBy(1, 2), flipped: toggleValue(true) }).toEqual({ sum: 3, flipped: false })',
  '})',
].join('\n')

const PACKAGE_ROOT = decodeURIComponent(new URL('..', import.meta.url).pathname).replace(/\/$/, '')

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
      ['package.json', PACKAGE_SOURCE],
      [MATH_FILE, MATH_SOURCE],
      [FIXTURE_FILE, FIXTURE_SOURCE],
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
  allowConsoleColors: false,
})

interface ObservedRun {
  readonly exit: Exit.Exit<Engine.MutationTestDone, Engine.StageError>
  readonly events: ReadonlyArray<RunEvent.RunEvent>
  readonly report: Option.Option<typeof Report.MutationTestResultSchema.Type>
}

const readReport = (
  directory: string,
): Effect.Effect<typeof Report.MutationTestResultSchema.Type, never, FileSystem.FileSystem> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const text = yield* fs.readFileString(reportFileOf(directory))
    return yield* S.decodeEffect(S.fromJsonString(Report.MutationTestResultSchema))(text)
  }).pipe(Effect.orDie)

const reportOf = (run: ObservedRun): typeof Report.MutationTestResultSchema.Type =>
  Option.getOrThrowWith(run.report, () => new Error('the run wrote no JSON report'))

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
          plugins: [pluginUrlOf('valid-framework.fixture.mjs')],
          reporters: ['json'],
          jsonReporter: { fileName: reportFileOf(workspace.directory) },
          thresholds: { high: 60, low: 40, break: 0 },
          checkers: [],
          testFiles: ['test/**/*.mjs'],
          mutate: ['src/**/*.ts', 'src/**/*.fixture'],
          cleanTempDir: 'always',
          incremental: true,
          incrementalFile: incrementalFileOf(workspace.directory),
        },
        targetMutatePatterns: undefined,
      })
      .pipe(Effect.provide(runLayer), Effect.scoped, Effect.exit)
    const events = yield* Queue.takeAll(queue).pipe(Effect.orElseSucceed(() => []))
    const report = yield* readReport(workspace.directory).pipe(Effect.option)
    return { exit, events: [...events], report }
  })

const runAndClean = (workspace: Workspace): Effect.Effect<ObservedRun, never, never> =>
  executeRun(workspace).pipe(
    Effect.ensuring(removeWorkspace(workspace.directory)),
    Effect.provide(filePorts),
  )

interface MutantRow {
  readonly file: string
  readonly id: string
  readonly mutator: string
  readonly replacement: string | null
  readonly status: Mutant.MutantStatus
  readonly location: Mutant.Location
}

const streamRowsOf = (events: ReadonlyArray<RunEvent.RunEvent>): readonly MutantRow[] =>
  events.filter(S.is(RunEvent.RunMutantTested)).map((mutant) => ({
    file: mutant.fileName,
    id: mutant.id,
    mutator: mutant.mutatorName,
    replacement: mutant.replacement,
    status: mutant.status,
    location: mutant.location,
  }))

const reportRowsOf = (report: typeof Report.MutationTestResultSchema.Type): readonly MutantRow[] =>
  Object.entries(report.files).flatMap(([file, fileResult]) =>
    fileResult.mutants.map((mutant) => ({
      file,
      id: mutant.id,
      mutator: mutant.mutatorName,
      replacement: mutant.replacement ?? null,
      status: mutant.status,
      location: mutant.location,
    }))
  )

const compareBy = <A>(keyOf: (row: A) => string): (left: A, right: A) => number => (left, right) =>
  keyOf(left) < keyOf(right) ? -1 : 1

const rowKey = (row: MutantRow): string => [row.file, row.id, row.mutator, row.replacement, row.status].join('|')

const sortedRows = (rows: readonly MutantRow[]): readonly MutantRow[] => rows.toSorted(compareBy(rowKey))

const lineOf = (content: string, line: number): string => {
  const found = content.split('\n')[line - 1]
  if (found === undefined) {
    throw new Error(`the fixture source has no line ${line}`)
  }
  return found
}

const slicedText = (content: string, location: Mutant.Location): string =>
  lineOf(content, location.start.line).slice(location.start.column - 1, location.end.column - 1)

interface PinnedMutant {
  readonly file: string
  readonly mutator: string
  readonly replacement: string
  readonly location: Mutant.Location
  readonly text: string
}

/**
 * The authored mutants of the two fixture sources, in the 1-based coordinates
 * the report and the machine stream must both speak: the line each node sits
 * on, the column of its first and last character, and the source text those
 * coordinates must slice out of the authored file.
 */
const PINNED_MUTANTS: readonly PinnedMutant[] = [
  {
    file: MATH_FILE,
    mutator: 'ArrowFunction',
    replacement: '() => undefined',
    location: { start: { line: 1, column: 28 }, end: { line: 1, column: 81 } },
    text: '(value: number, step: number): number => value + step',
  },
  {
    file: MATH_FILE,
    mutator: 'ArithmeticOperator',
    replacement: 'value - step',
    location: { start: { line: 1, column: 69 }, end: { line: 1, column: 81 } },
    text: 'value + step',
  },
  {
    file: MATH_FILE,
    mutator: 'ArrowFunction',
    replacement: '() => undefined',
    location: { start: { line: 3, column: 28 }, end: { line: 3, column: 63 } },
    text: '(value: boolean): boolean => !value',
  },
  {
    file: MATH_FILE,
    mutator: 'BooleanLiteral',
    replacement: 'value',
    location: { start: { line: 3, column: 57 }, end: { line: 3, column: 63 } },
    text: '!value',
  },
  {
    file: FIXTURE_FILE,
    mutator: 'BlockStatement',
    replacement: '{}',
    location: { start: { line: 1, column: 28 }, end: { line: 1, column: 45 } },
    text: '{ return a + b; }',
  },
  {
    file: FIXTURE_FILE,
    mutator: 'ArithmeticOperator',
    replacement: 'a - b',
    location: { start: { line: 1, column: 37 }, end: { line: 1, column: 42 } },
    text: 'a + b',
  },
]

interface PinnedRow {
  readonly file: string
  readonly mutator: string
  readonly replacement: string | null
  readonly location: Mutant.Location
  readonly text: string
}

const pinnedRowOf = (row: MutantRow): PinnedRow => ({
  file: row.file,
  mutator: row.mutator,
  replacement: row.replacement,
  location: row.location,
  text: slicedText(SOURCES[row.file] ?? '', row.location),
})

const pinnedKey = (row: PinnedRow): string =>
  [row.file, row.location.start.line, row.location.start.column, row.mutator, row.replacement].join('|')

const sortedPinned = (rows: readonly PinnedRow[]): readonly PinnedRow[] => rows.toSorted(compareBy(pinnedKey))

Feature('Mutant coordinates reaching every host output')
  .withLayer(Layer.empty)
  .live('the run spawns the vm worker and the real vitest oracle and writes reports to the host filesystem')
  .body(({ scenario }) => {
    scenario(
      'A finished run reports the same mutant span to the stream and to the report',
      Gherkin.Do.pipe(
        Given('a workspace with a TypeScript module and a component its configured framework claims')(
          'workspace',
          () => writeWorkspace().pipe(Effect.provide(filePorts)),
        ),
        When('a mutation run executes over the workspace')('observation', (s) => runAndClean(s.workspace)),
        Then(
          'the run reaches a verdict, and the stream and report name the same mutant at the same authored coordinates',
        )(
          (s, expect) => {
            const stream = sortedRows(streamRowsOf(s.observation.events))
            const report = sortedRows(reportRowsOf(reportOf(s.observation)))
            return expect({
              verdictReached: Exit.isSuccess(s.observation.exit),
              streamMatchesReport: stream,
              pinnedNodes: sortedPinned(streamRowsOf(s.observation.events).map(pinnedRowOf)),
            }).toEqual({
              verdictReached: true,
              streamMatchesReport: report,
              pinnedNodes: sortedPinned(PINNED_MUTANTS),
            })
          },
        ),
      ),
    )
  })
