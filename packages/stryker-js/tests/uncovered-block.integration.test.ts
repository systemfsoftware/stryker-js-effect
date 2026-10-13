import { Gherkin, Given, it, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import { Engine } from '@systemfsoftware/stryker-js'
import { Mutant, Report } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Effect from 'effect/Effect'
import * as Fiber from 'effect/Fiber'
import * as FileSystem from 'effect/FileSystem'
import * as Option from 'effect/Option'
import * as Path from 'effect/Path'
import * as ChildProcess from 'effect/process/ChildProcess'
import * as ChildProcessSpawner from 'effect/process/ChildProcessSpawner'
import * as S from 'effect/Schema'
import * as Scope from 'effect/Scope'
import * as Stream from 'effect/Stream'

type ReportRow = Report.MutantResult

const Feature = makeFeature({ it })

const PACKAGE_ROOT = decodeURIComponent(new URL('..', import.meta.url).pathname).replace(/\/$/, '')
const STRYKER_BIN = decodeURIComponent(new URL('../dist/main.mjs', import.meta.url).pathname)

const BLOCK_CHECKER_PLUGIN = new URL('./__fixtures__/guarded-block-checker/index.mjs', import.meta.url).href

const REPORT_FILE = 'reports/mutation/mutation.json'
const CONFIG_FILE = 'stryker.config.mjs'

const WORK_FILE = 'src/lib/work.ts'
const TEST_FILE = 'test/sample.test.mjs'

const WORK_SOURCE = [
  'export const compute = (value: number): number => value',
  '',
  'export const work = (flag: boolean): number => {',
  '  if (flag) {',
  '    return compute(1 + 1)',
  '  }',
  '  return 0',
  '}',
  '',
].join('\n')

const ELSE_WORK_SOURCE = [
  'export const compute = (value: number): number => value',
  '',
  'export const work = (flag: boolean): number => {',
  '  if (flag) {',
  '    return compute(1 + 1)',
  '  } else {',
  '    return compute(0)',
  '  }',
  '}',
  '',
].join('\n')

const RELATIONAL_WORK_SOURCE = [
  'export const compute = (value: number): number => value',
  '',
  'export const work = (limit: number): number => {',
  '  if (limit > 3) {',
  '    return compute(1 + 1)',
  '  }',
  '  return 0',
  '}',
  '',
].join('\n')

const CONDITION_LINE = 4
const BLOCK_BODY_LINE = 5
const BLOCK_END_LINE = 6

const ARID_PREFIX = 'arid-uncovered-block: '

const UNVISITED_TEST_SOURCE = [
  "import { expect, test } from 'vitest'",
  `import { work } from '../${WORK_FILE}'`,
  '',
  "test('leaves the guarded block unvisited', () => {",
  '  expect(work(false)).toBe(0)',
  '})',
  '',
].join('\n')

const VISITED_TEST_SOURCE = [
  UNVISITED_TEST_SOURCE.trimEnd(),
  '',
  "test('visits the guarded block', () => {",
  '  expect(work(true)).toBe(2)',
  '})',
  '',
].join('\n')

const VITEST_CONFIG_SOURCE = 'export default { test: { testTimeout: 600_000, hookTimeout: 600_000 } }\n'

const workspaceFilesOf = (
  testSource: string,
  workSource: string = WORK_SOURCE,
): ReadonlyArray<readonly [string, string]> => [
  ['package.json', '{ "type": "commonjs" }\n'],
  ['vitest.config.ts', VITEST_CONFIG_SOURCE],
  [WORK_FILE, workSource],
  [TEST_FILE, testSource],
]

interface RunOptions {
  readonly checkers?: ReadonlyArray<{ readonly plugin: string }>
  readonly coverageAnalysis?: 'perTest' | 'all'
  readonly mutantSetPolicy?: 'full'
  readonly excludedMutations?: ReadonlyArray<string>
  readonly incremental?: boolean
}

const configSourceOf = (options: RunOptions): string =>
  `export default ${
    JSON.stringify(
      {
        testRunner: 'vm',
        plugins: [],
        checkers: options.checkers ?? [],
        testFiles: ['test/**/*.mjs'],
        mutate: ['src/**/*.ts'],
        coverageAnalysis: options.coverageAnalysis ?? 'perTest',
        concurrency: 1,
        reporters: ['json'],
        cleanTempDir: 'always',
        incremental: options.incremental ?? true,
        ...(options.mutantSetPolicy === undefined && options.excludedMutations === undefined
          ? {}
          : {
            mutator: {
              ...(options.mutantSetPolicy === undefined ? {} : { mutantSetPolicy: options.mutantSetPolicy }),
              ...(options.excludedMutations === undefined ? {} : { excludedMutations: [...options.excludedMutations] }),
            },
          }),
      },
      null,
      2,
    )
  }\n`

const decodeReport = S.decodeUnknownOption(S.fromJsonString(Report.MutationTestResult))

interface Project {
  readonly root: string
}

interface StrykerRun {
  readonly exitCode: number
  readonly stderr: string
}

const requireBinary = (): Effect.Effect<void, never, FileSystem.FileSystem> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const binaryPresent = yield* fs.exists(STRYKER_BIN)
    yield* Effect.when(
      Effect.die(new Error('dist/main.mjs is missing — build the package first')),
      Effect.succeed(!binaryPresent),
    )
  }).pipe(Effect.orDie)

const prepareProject = (
  testSource: string,
  options: RunOptions = {},
  workSource: string = WORK_SOURCE,
): Effect.Effect<Project, never, FileSystem.FileSystem | Path.Path | Scope.Scope> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    yield* requireBinary()
    const root = yield* fs.realPath(yield* fs.makeTempDirectoryScoped({ prefix: 'stryker-uncovered-block-' }))
    yield* Effect.forEach(
      workspaceFilesOf(testSource, workSource),
      ([name, content]) =>
        Effect.gen(function*() {
          const target = path.join(root, name)
          yield* fs.makeDirectory(path.dirname(target), { recursive: true })
          yield* fs.writeFileString(target, content)
        }),
      { discard: true },
    )
    yield* fs.writeFileString(path.join(root, CONFIG_FILE), configSourceOf(options))
    yield* fs.symlink(path.join(PACKAGE_ROOT, 'node_modules'), path.join(root, 'node_modules'))
    return { root }
  }).pipe(Effect.orDie)

const runStryker = (root: string): Effect.Effect<StrykerRun, never, ChildProcessSpawner.ChildProcessSpawner> =>
  Effect.scoped(
    Effect.gen(function*() {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
      const handle = yield* spawner.spawn(
        ChildProcess.make(globalThis.process.execPath, [STRYKER_BIN, 'run'], {
          cwd: root,
          stdin: 'ignore',
          stdout: 'pipe',
          stderr: 'pipe',
          env: { STRYKER_MODE: 'machine', NO_COLOR: '1', GITHUB_ACTIONS: '', ALLOW_LOCAL_MUTATION: '1' },
          extendEnv: true,
        }),
      )
      const drained = yield* Effect.forkScoped(handle.stdout.pipe(Stream.decodeText, Stream.runDrain))
      const printedErr = yield* Effect.forkScoped(handle.stderr.pipe(Stream.decodeText, Stream.mkString))
      const exitCode = yield* handle.exitCode
      yield* Fiber.join(drained)
      return { exitCode: Number(exitCode), stderr: yield* Fiber.join(printedErr) }
    }),
  ).pipe(Effect.orDie)

const readReport = (
  root: string,
  ran: StrykerRun,
): Effect.Effect<readonly ReportRow[], never, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const text = yield* fs.readFileString(path.join(root, REPORT_FILE)).pipe(
      Effect.catch(() =>
        Effect.die(new Error(`the run wrote no ${REPORT_FILE} (exit ${ran.exitCode})\n${ran.stderr}`))
      ),
    )
    const report = Option.getOrThrowWith(
      decodeReport(text),
      () => new Error(`the run wrote an unreadable ${REPORT_FILE}: ${text.slice(0, 200)}`),
    )
    return Object.values(report.files).flatMap((file) => file.mutants)
  }).pipe(Effect.orDie)

const onConditionLine = (row: ReportRow): boolean =>
  row.location.start.line === CONDITION_LINE && row.location.end.line === CONDITION_LINE

const inBlockBody = (row: ReportRow): boolean => row.location.start.line === BLOCK_BODY_LINE

const consequentBlockMutantsOf = (rows: readonly ReportRow[]): readonly ReportRow[] =>
  rows.filter((row) =>
    row.mutatorName === 'BlockStatement' &&
    row.location.start.line === CONDITION_LINE &&
    row.location.end.line === BLOCK_END_LINE
  )

const aridIgnoredOf = (rows: readonly ReportRow[]): readonly ReportRow[] =>
  rows.filter((row) => row.status === 'Ignored' && (row.statusReason ?? '').startsWith(ARID_PREFIX))

const idsInReason = (reason: string | undefined): readonly string[] => reason?.match(/[0-9a-f]{16}/gu) ?? []

const ranStatus = (status: Mutant.MutantStatus): boolean => status === 'Killed' || status === 'Survived'

const refusalShapeOf = (ran: StrykerRun, rows: readonly ReportRow[]) => {
  const conditions = rows.filter(onConditionLine)
  return {
    exitCode: ran.exitCode,
    aridReasons: aridIgnoredOf(rows).length,
    conditionCount: conditions.length,
    everyConditionRan: conditions.length > 0 && conditions.every((row) => ranStatus(row.status)),
  }
}

const appendToTestSource = (root: string): Effect.Effect<void, never, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const target = path.join(root, TEST_FILE)
    const current = yield* fs.readFileString(target)
    yield* fs.writeFileString(
      target,
      `${current}// an unrelated test edit invalidates the covered condition mutants and forces them to re-decide\n`,
    )
  }).pipe(Effect.orDie)

Feature('Holding a condition mutant whose guarded block no test runs', { timeout: 180_000 })
  .withLayer(Engine.nodePlatformLayer)
  .live('the built stryker binary runs each fixture project in a real Node process and the report on disk is read back')
  .body(({ scenario }) => {
    scenario(
      'A perTest run whose test never enters the block ignores the condition mutants as arid-uncovered-block and leaves the block mutants NoCoverage',
      Gherkin.Do.pipe(
        Given('a project whose only test calls the guarded function with the flag false')(
          'project',
          () => prepareProject(UNVISITED_TEST_SOURCE),
        ),
        When('stryker runs it')('ran', (s) => runStryker(s.project.root)),
        When('the written mutation report is read back')('rows', (s) => readReport(s.project.root, s.ran)),
        Then('every condition mutant is Ignored arid and every block member is NoCoverage')((s, expect) => {
          const conditions = s.rows.filter(onConditionLine)
          const inside = s.rows.filter(inBlockBody)
          const blocks = consequentBlockMutantsOf(s.rows)
          const arid = aridIgnoredOf(s.rows)
          const namedIds = [...new Set(arid.flatMap((row) => idsInReason(row.statusReason)))]
          const statusById = new Map<string, Mutant.MutantStatus>(s.rows.map((row) => [row.id, row.status]))
          return expect({
            exitCode: s.ran.exitCode,
            conditionCount: conditions.length,
            everyConditionIsArid: conditions.length > 0 &&
              conditions.every((row) => row.status === 'Ignored' && (row.statusReason ?? '').startsWith(ARID_PREFIX)),
            aridIsOnlyConditions: arid.length === conditions.length,
            insideCountPositive: inside.length > 0,
            everyInsideIsNoCoverage: inside.length > 0 && inside.every((row) => row.status === 'NoCoverage'),
            consequentBlockCount: blocks.length,
            consequentBlockNoCoverage: blocks.length === 1 && blocks[0]?.status === 'NoCoverage',
            namedMembersNoCoverage: namedIds.length > 0 &&
              namedIds.every((id) => statusById.get(id) === 'NoCoverage'),
          }).toEqual({
            exitCode: 0,
            conditionCount: 2,
            everyConditionIsArid: true,
            aridIsOnlyConditions: true,
            insideCountPositive: true,
            everyInsideIsNoCoverage: true,
            consequentBlockCount: 1,
            consequentBlockNoCoverage: true,
            namedMembersNoCoverage: true,
          })
        }),
      ),
    )

    scenario(
      'A checker fails every block member to compile, so the condition mutants run instead of being held',
      Gherkin.Do.pipe(
        Given(
          'a project whose only test calls the guarded function with the flag false, under a checker that rejects the block mutants',
        )(
          'project',
          () => prepareProject(UNVISITED_TEST_SOURCE, { checkers: [{ plugin: BLOCK_CHECKER_PLUGIN }] }),
        ),
        When('stryker runs it')('ran', (s) => runStryker(s.project.root)),
        When('the written mutation report is read back')('rows', (s) => readReport(s.project.root, s.ran)),
        Then('the block mutants are CompileError and the condition mutants ran')((s, expect) => {
          const blocks = s.rows.filter((row) => row.mutatorName === 'BlockStatement')
          const inside = s.rows.filter(inBlockBody)
          return expect({
            ...refusalShapeOf(s.ran, s.rows),
            everyBlockIsCompileError: blocks.length > 0 &&
              blocks.every((row) => row.status === 'CompileError'),
            everyInsideIsCompileError: inside.length > 0 && inside.every((row) => row.status === 'CompileError'),
          }).toEqual({
            exitCode: 0,
            aridReasons: 0,
            conditionCount: 2,
            everyConditionRan: true,
            everyBlockIsCompileError: true,
            everyInsideIsCompileError: true,
          })
        }),
      ),
    )

    scenario(
      'A test that enters the guarded block keeps the condition mutants out of the arid ruling',
      Gherkin.Do.pipe(
        Given('a project whose tests call the guarded function with both flag values')(
          'project',
          () => prepareProject(VISITED_TEST_SOURCE),
        ),
        When('stryker runs it')('ran', (s) => runStryker(s.project.root)),
        When('the written mutation report is read back')('rows', (s) => readReport(s.project.root, s.ran)),
        Then('no mutant is ignored arid and the condition mutants ran')((s, expect) =>
          expect(refusalShapeOf(s.ran, s.rows)).toEqual({
            exitCode: 0,
            aridReasons: 0,
            conditionCount: 2,
            everyConditionRan: true,
          })
        ),
      ),
    )

    scenario(
      'A test that runs the else block keeps the condition mutants out of the arid ruling',
      Gherkin.Do.pipe(
        Given('a project whose only test calls the function with the flag false, so its else block runs')(
          'project',
          () => prepareProject(UNVISITED_TEST_SOURCE, {}, ELSE_WORK_SOURCE),
        ),
        When('stryker runs it')('ran', (s) => runStryker(s.project.root)),
        When('the written mutation report is read back')('rows', (s) => readReport(s.project.root, s.ran)),
        Then('no mutant is ignored arid and the condition mutants ran')((s, expect) =>
          expect(refusalShapeOf(s.ran, s.rows)).toEqual({
            exitCode: 0,
            aridReasons: 0,
            conditionCount: 2,
            everyConditionRan: true,
          })
        ),
      ),
    )

    scenario(
      'An excluded BlockStatement whose else block a test runs keeps the condition mutants out of the arid ruling',
      Gherkin.Do.pipe(
        Given(
          'a project whose only test calls the function with the flag false, so its else block runs, under an excluded BlockStatement mutator',
        )(
          'project',
          () => prepareProject(UNVISITED_TEST_SOURCE, { excludedMutations: ['BlockStatement'] }, ELSE_WORK_SOURCE),
        ),
        When('stryker runs it')('ran', (s) => runStryker(s.project.root)),
        When('the written mutation report is read back')('rows', (s) => readReport(s.project.root, s.ran)),
        Then('no mutant is ignored arid and the condition mutants ran')((s, expect) =>
          expect(refusalShapeOf(s.ran, s.rows)).toEqual({
            exitCode: 0,
            aridReasons: 0,
            conditionCount: 2,
            everyConditionRan: true,
          })
        ),
      ),
    )

    scenario(
      'A subsumed condition mutant whose dominators are held arid is readmitted and settles exactly once',
      Gherkin.Do.pipe(
        Given('a project whose guarded if tests a relational condition no test makes true')(
          'project',
          () => prepareProject(UNVISITED_TEST_SOURCE, {}, RELATIONAL_WORK_SOURCE),
        ),
        When('stryker runs it')('ran', (s) => runStryker(s.project.root)),
        When('the written mutation report is read back')('rows', (s) => readReport(s.project.root, s.ran)),
        Then('every mutant id has one result, and a readmitted condition mutant ran')((s, expect) => {
          const ids = s.rows.map((row) => row.id)
          return expect({
            exitCode: s.ran.exitCode,
            resultCount: ids.length,
            readmittedConditionRan: s.rows.filter(onConditionLine).some((row) =>
              S.is(Mutant.Readmitted)(row['subsumption']) && ranStatus(row.status)
            ),
          }).toEqual({
            exitCode: 0,
            resultCount: new Set(ids).size,
            readmittedConditionRan: true,
          })
        }),
      ),
    )

    scenario(
      'coverageAnalysis all leaves no mutant ignored arid',
      Gherkin.Do.pipe(
        Given('a project whose only test calls the guarded function with the flag false, under coverageAnalysis all')(
          'project',
          () => prepareProject(UNVISITED_TEST_SOURCE, { coverageAnalysis: 'all' }),
        ),
        When('stryker runs it')('ran', (s) => runStryker(s.project.root)),
        When('the written mutation report is read back')('rows', (s) => readReport(s.project.root, s.ran)),
        Then('no mutant is ignored arid and the condition mutants ran')((s, expect) =>
          expect(refusalShapeOf(s.ran, s.rows)).toEqual({
            exitCode: 0,
            aridReasons: 0,
            conditionCount: 2,
            everyConditionRan: true,
          })
        ),
      ),
    )

    scenario(
      'mutator.mutantSetPolicy full leaves no mutant ignored arid',
      Gherkin.Do.pipe(
        Given(
          'a project whose only test calls the guarded function with the flag false, under the full mutant set policy',
        )(
          'project',
          () => prepareProject(UNVISITED_TEST_SOURCE, { mutantSetPolicy: 'full' }),
        ),
        When('stryker runs it')('ran', (s) => runStryker(s.project.root)),
        When('the written mutation report is read back')('rows', (s) => readReport(s.project.root, s.ran)),
        Then('no mutant is ignored arid and the condition mutants ran')((s, expect) =>
          expect(refusalShapeOf(s.ran, s.rows)).toEqual({
            exitCode: 0,
            aridReasons: 0,
            conditionCount: 2,
            everyConditionRan: true,
          })
        ),
      ),
    )

    scenario(
      'An excluded BlockStatement whose block no test runs is reused while a test edit re-decides the condition mutants, and they still run',
      Gherkin.Do.pipe(
        Given(
          'a project whose only test leaves the guarded block unvisited, under an excluded BlockStatement mutator',
        )(
          'project',
          () => prepareProject(UNVISITED_TEST_SOURCE, { excludedMutations: ['BlockStatement'] }),
        ),
        When('stryker runs it')('first', (s) => runStryker(s.project.root)),
        When('the report of the first run is read back')('firstRows', (s) => readReport(s.project.root, s.first)),
        When('an unrelated test edit invalidates the covered condition mutants while the block mutant stays reusable')(
          'edited',
          (s) => Effect.as(appendToTestSource(s.project.root), s.project.root),
        ),
        When('stryker runs it again incrementally')('second', (s) => runStryker(s.project.root)),
        When('the report of the second run is read back')('secondRows', (s) => readReport(s.project.root, s.second)),
        Then('both runs ran the condition mutants with no arid ruling')((s, expect) => {
          const first = refusalShapeOf(s.first, s.firstRows)
          const second = refusalShapeOf(s.second, s.secondRows)
          return expect({
            first: {
              aridReasons: first.aridReasons,
              conditionCount: first.conditionCount,
              everyConditionRan: first.everyConditionRan,
            },
            second: {
              exitCode: second.exitCode,
              aridReasons: second.aridReasons,
              conditionCount: second.conditionCount,
              everyConditionRan: second.everyConditionRan,
            },
          }).toEqual({
            first: { aridReasons: 0, conditionCount: 2, everyConditionRan: true },
            second: { exitCode: 0, aridReasons: 0, conditionCount: 2, everyConditionRan: true },
          })
        }),
      ),
    )
  })
