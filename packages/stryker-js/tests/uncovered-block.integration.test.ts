import { NodeFileSystem, NodePath } from '@effect/platform-node'
import { Gherkin, Given, it, makeFeature, Then } from '@systemfsoftware/effect-gherkin-spec'
import { Engine } from '@systemfsoftware/stryker-js'
import { RunEvent } from '@systemfsoftware/stryker-js-cli-contract'
import { Mutant } from '@systemfsoftware/stryker-js-plugin-interface'
import type { Options } from '@systemfsoftware/stryker-js-plugin-interface'
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

const BLOCK_CHECKER_PLUGIN = new URL('./__fixtures__/guarded-block-checker/index.mjs', import.meta.url).href

const WORK_FILE = 'src/lib/work.ts'

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
  ['vitest.config.ts', VITEST_CONFIG_SOURCE],
  [WORK_FILE, workSource],
  ['test/sample.test.mjs', testSource],
]

interface Workspace {
  readonly directory: string
}

const environmentFor = (directory: string): Engine.RunEnvironmentShape => ({
  runId: '01ARZ3NDEKTSV4RRFFQ69G5FAX',
  resolvedMode: { mode: 'machine', signal: 'flag', stdoutIsTTY: false },
  runStartedAt: 0,
  basePath: directory,
  builtinReporters: {},
  allowConsoleColors: false,
})

const writeWorkspace = (
  files: ReadonlyArray<readonly [string, string]>,
): Effect.Effect<Workspace, never, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const directory = yield* fs.realPath(yield* fs.makeTempDirectory({ prefix: 'stryker-uncovered-block-' }))
    yield* fs.writeFileString(path.join(directory, 'package.json'), '{ "type": "commonjs" }\n')
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

const removeWorkspace = (directory: string): Effect.Effect<void, never, never> =>
  Effect.provide(
    Effect.orDie(Effect.flatMap(FileSystem.FileSystem, (fs) => fs.remove(directory, { recursive: true, force: true }))),
    filePorts,
  )

type CheckerSpec = NonNullable<Options.PartialStrykerOptions['checkers']>[number]

const cliOptionsOf = (
  directory: string,
  checkers: readonly CheckerSpec[],
  extras: Options.PartialStrykerOptions,
): Options.PartialStrykerOptions => ({
  testRunner: 'vm',
  plugins: [],
  reporters: [],
  checkers,
  testFiles: ['test/**/*.mjs'],
  mutate: ['src/**/*.ts'],
  coverageAnalysis: 'perTest',
  concurrency: 1,
  tempDirName: `.stryker-tmp-${directory.slice(directory.lastIndexOf('/') + 1)}`,
  cleanTempDir: 'always',
  incremental: false,
  ...extras,
})

interface RunObservation {
  readonly exit: Exit.Exit<Engine.MutationTestDone, Engine.StageError>
  readonly results: readonly Mutant.RunMutantResult[]
}

const runEngine = (
  directory: string,
  checkers: readonly CheckerSpec[],
  extras: Options.PartialStrykerOptions,
): Effect.Effect<RunObservation, never, never> =>
  Effect.gen(function*() {
    const queue = yield* Queue.bounded<RunEvent.RunEvent, Cause.Done>(RunEvent.RunEvent.QUEUE_BOUND)
    const ports = Engine.nodePlatformLayer
    const runLayer = Layer.merge(
      Layer.provide(Engine.RunEnvironment.stage(environmentFor(directory), queue), ports),
      ports,
    )
    const exit = yield* Engine.mutationTestCell
      .run({ cliOptions: cliOptionsOf(directory, checkers, extras), targetMutatePatterns: undefined })
      .pipe(Effect.provide(runLayer), Effect.scoped, Effect.exit)
    if (Exit.isFailure(exit)) {
      return yield* Effect.die(exit.cause)
    }
    yield* Queue.end(queue).pipe(
      Effect.andThen(Queue.takeAll(queue)),
      Effect.orElseSucceed((): ReadonlyArray<RunEvent.RunEvent> => []),
    )
    return { exit, results: exit.value.results }
  }).pipe(Effect.orDie, Effect.provide(filePorts))

const runWorkspace = (
  files: ReadonlyArray<readonly [string, string]>,
  checkers: readonly CheckerSpec[],
  extras: Options.PartialStrykerOptions = {},
): Effect.Effect<RunObservation, never, never> =>
  Effect.gen(function*() {
    const workspace = yield* writeWorkspace(files)
    return yield* Effect.ensuring(
      runEngine(workspace.directory, checkers, extras),
      removeWorkspace(workspace.directory),
    )
  }).pipe(Effect.orDie, Effect.provide(filePorts))

const onConditionLine = (result: Mutant.RunMutantResult): boolean =>
  result.location.start.line === CONDITION_LINE && result.location.end.line === CONDITION_LINE

const inBlockBody = (result: Mutant.RunMutantResult): boolean => result.location.start.line === BLOCK_BODY_LINE

const consequentBlockMutantsOf = (results: readonly Mutant.RunMutantResult[]): readonly Mutant.RunMutantResult[] =>
  results.filter((result) =>
    result.mutatorName === 'BlockStatement' &&
    result.location.start.line === CONDITION_LINE &&
    result.location.end.line === BLOCK_END_LINE
  )

const aridIgnoredOf = (results: readonly Mutant.RunMutantResult[]): readonly Mutant.RunMutantResult[] =>
  results.filter((result) => result.status === 'Ignored' && (result.statusReason ?? '').startsWith(ARID_PREFIX))

const idsInReason = (reason: string | undefined): readonly string[] => reason?.match(/[0-9a-f]{16}/gu) ?? []

const ranStatus = (status: Mutant.MutantStatus): boolean => status === 'Killed' || status === 'Survived'

const refusalShapeOf = (observation: RunObservation) => {
  const conditions = observation.results.filter(onConditionLine)
  return {
    runSucceeded: Exit.isSuccess(observation.exit),
    aridReasons: aridIgnoredOf(observation.results).length,
    conditionCount: conditions.length,
    everyConditionRan: conditions.length > 0 && conditions.every((result) => ranStatus(result.status)),
  }
}

Feature('Holding a condition mutant whose guarded block no test runs')
  .withLayer(Layer.empty)
  .live('each scenario drives the real engine in-process over a workspace and the vm test runner')
  .body(({ scenario }) => {
    scenario(
      'A perTest run whose test never enters the block ignores the condition mutants as arid-uncovered-block and leaves the block mutants NoCoverage',
      Gherkin.Do.pipe(
        Given('a project whose only test calls the guarded function with the flag false')(
          'observation',
          () => runWorkspace(workspaceFilesOf(UNVISITED_TEST_SOURCE), []),
        ),
        Then('every condition mutant is Ignored arid and every block member is NoCoverage')((s, expect) => {
          const conditions = s.observation.results.filter(onConditionLine)
          const inside = s.observation.results.filter(inBlockBody)
          const blocks = consequentBlockMutantsOf(s.observation.results)
          const arid = aridIgnoredOf(s.observation.results)
          const namedIds = [...new Set(arid.flatMap((result) => idsInReason(result.statusReason)))]
          const statusById = new Map<string, Mutant.MutantStatus>(
            s.observation.results.map((result) => [result.id, result.status]),
          )
          return expect({
            runSucceeded: Exit.isSuccess(s.observation.exit),
            conditionCount: conditions.length,
            everyConditionIsArid: conditions.length > 0 &&
              conditions.every((result) =>
                result.status === 'Ignored' && (result.statusReason ?? '').startsWith(ARID_PREFIX)
              ),
            aridIsOnlyConditions: arid.length === conditions.length,
            insideCountPositive: inside.length > 0,
            everyInsideIsNoCoverage: inside.length > 0 && inside.every((result) => result.status === 'NoCoverage'),
            consequentBlockCount: blocks.length,
            consequentBlockNoCoverage: blocks.length === 1 && blocks[0]?.status === 'NoCoverage',
            namedMembersNoCoverage: namedIds.length > 0 &&
              namedIds.every((id) => statusById.get(id) === 'NoCoverage'),
          }).toEqual({
            runSucceeded: true,
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
          'observation',
          () => runWorkspace(workspaceFilesOf(UNVISITED_TEST_SOURCE), [{ plugin: BLOCK_CHECKER_PLUGIN }]),
        ),
        Then('the block mutants are CompileError and the condition mutants ran')((s, expect) => {
          const blocks = s.observation.results.filter((result) => result.mutatorName === 'BlockStatement')
          const inside = s.observation.results.filter(inBlockBody)
          return expect({
            ...refusalShapeOf(s.observation),
            everyBlockIsCompileError: blocks.length > 0 &&
              blocks.every((result) => result.status === 'CompileError'),
            everyInsideIsCompileError: inside.length > 0 && inside.every((result) => result.status === 'CompileError'),
          }).toEqual({
            runSucceeded: true,
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
          'observation',
          () => runWorkspace(workspaceFilesOf(VISITED_TEST_SOURCE), []),
        ),
        Then('no mutant is ignored arid and the condition mutants ran')((s, expect) =>
          expect(refusalShapeOf(s.observation)).toEqual({
            runSucceeded: true,
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
          'observation',
          () => runWorkspace(workspaceFilesOf(UNVISITED_TEST_SOURCE, ELSE_WORK_SOURCE), []),
        ),
        Then('no mutant is ignored arid and the condition mutants ran')((s, expect) =>
          expect(refusalShapeOf(s.observation)).toEqual({
            runSucceeded: true,
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
          'observation',
          () => runWorkspace(workspaceFilesOf(UNVISITED_TEST_SOURCE, RELATIONAL_WORK_SOURCE), []),
        ),
        Then('every mutant id has one result, and a readmitted condition mutant ran')((s, expect) => {
          const ids = s.observation.results.map((result) => result.id)
          return expect({
            runSucceeded: Exit.isSuccess(s.observation.exit),
            resultCount: ids.length,
            readmittedConditionRan: s.observation.results.filter(onConditionLine).some((result) =>
              S.is(Mutant.Readmitted)(result.subsumption) && ranStatus(result.status)
            ),
          }).toEqual({
            runSucceeded: true,
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
          'observation',
          () => runWorkspace(workspaceFilesOf(UNVISITED_TEST_SOURCE), [], { coverageAnalysis: 'all' }),
        ),
        Then('no mutant is ignored arid and the condition mutants ran')((s, expect) =>
          expect(refusalShapeOf(s.observation)).toEqual({
            runSucceeded: true,
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
          'observation',
          () =>
            runWorkspace(workspaceFilesOf(UNVISITED_TEST_SOURCE), [], {
              mutator: { mutantSetPolicy: 'full' },
            }),
        ),
        Then('no mutant is ignored arid and the condition mutants ran')((s, expect) =>
          expect(refusalShapeOf(s.observation)).toEqual({
            runSucceeded: true,
            aridReasons: 0,
            conditionCount: 2,
            everyConditionRan: true,
          })
        ),
      ),
    )
  })
