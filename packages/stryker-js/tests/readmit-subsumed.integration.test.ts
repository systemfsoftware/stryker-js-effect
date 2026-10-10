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

const Feature = makeFeature({ it })

const filePorts = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer)

const PACKAGE_ROOT = decodeURIComponent(new URL('..', import.meta.url).pathname).replace(/\/$/, '')

const CHECKER_PLUGIN = new URL('./__fixtures__/subsumption-checker/index.mjs', import.meta.url).href

const SUBSUMED_FILE = 'src/lib/subsumed.ts'
const UNCOVERED_FILE = 'src/lib/uncovered.ts'
const COVERED_FILE = 'src/lib/covered.ts'

const RELATIONAL_SOURCE = 'export const less = (a: number, b: number): number => a < b ? 1 : 0\n'
const COVERED_SOURCE = 'export const double = (n: number): number => n * 2\n'

const COVERING_TEST_SOURCE = [
  "import { expect, test } from 'vitest'",
  `import { less } from '../${SUBSUMED_FILE}'`,
  '',
  "test('orders two numbers', () => {",
  '  expect(less(1, 2)).toBe(1)',
  '  expect(less(3, 2)).toBe(0)',
  '})',
  '',
].join('\n')

const UNRELATED_TEST_SOURCE = [
  "import { expect, test } from 'vitest'",
  `import { double } from '../${COVERED_FILE}'`,
  '',
  "test('doubles a number', () => {",
  '  expect(double(2)).toBe(4)',
  '})',
  '',
].join('\n')

const VITEST_CONFIG_SOURCE = 'export default { test: { testTimeout: 600_000, hookTimeout: 600_000 } }\n'

interface Workspace {
  readonly directory: string
}

const environmentFor = (directory: string): Engine.RunEnvironmentShape => ({
  runId: '01ARZ3NDEKTSV4RRFFQ69G5FAY',
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
    const directory = yield* fs.realPath(yield* fs.makeTempDirectory({ prefix: 'stryker-readmit-' }))
    yield* fs.writeFileString(
      path.join(directory, 'package.json'),
      '{ "type": "commonjs" }\n',
    )
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
})

const runEngine = (
  directory: string,
  checkers: readonly CheckerSpec[],
): Effect.Effect<readonly Mutant.RunMutantResult[], never, never> =>
  Effect.gen(function*() {
    const queue = yield* Queue.bounded<RunEvent.RunEvent, Cause.Done>(RunEvent.RunEvent.QUEUE_BOUND)
    const ports = Engine.nodePlatformLayer
    const runLayer = Layer.merge(
      Layer.provide(Engine.RunEnvironment.stage(environmentFor(directory), queue), ports),
      ports,
    )
    const exit = yield* Engine.mutationTestCell
      .run({
        cliOptions: cliOptionsOf(directory, checkers),
        targetMutatePatterns: undefined,
      })
      .pipe(Effect.provide(runLayer), Effect.scoped, Effect.exit)
    if (Exit.isFailure(exit)) {
      return yield* Effect.die(exit.cause)
    }
    yield* Queue.end(queue).pipe(
      Effect.andThen(Queue.takeAll(queue)),
      Effect.orElseSucceed((): ReadonlyArray<RunEvent.RunEvent> => []),
    )
    return exit.value.results
  }).pipe(Effect.orDie, Effect.provide(filePorts))

const runWorkspace = (
  files: ReadonlyArray<readonly [string, string]>,
  checkers: readonly CheckerSpec[],
): Effect.Effect<readonly Mutant.RunMutantResult[], never, never> =>
  Effect.gen(function*() {
    const workspace = yield* writeWorkspace(files)
    return yield* Effect.ensuring(
      runEngine(workspace.directory, checkers),
      removeWorkspace(workspace.directory),
    )
  }).pipe(Effect.orDie, Effect.provide(filePorts))

const COVERED_WORKSPACE_FILES: ReadonlyArray<readonly [string, string]> = [
  ['vitest.config.ts', VITEST_CONFIG_SOURCE],
  [SUBSUMED_FILE, RELATIONAL_SOURCE],
  ['test/sample.test.mjs', COVERING_TEST_SOURCE],
]

const UNCOVERED_WORKSPACE_FILES: ReadonlyArray<readonly [string, string]> = [
  ['vitest.config.ts', VITEST_CONFIG_SOURCE],
  [UNCOVERED_FILE, RELATIONAL_SOURCE],
  [COVERED_FILE, COVERED_SOURCE],
  ['test/sample.test.mjs', UNRELATED_TEST_SOURCE],
]

Feature('Re-admitting a subsumed mutant when none of its dominators runs')
  .withLayer(Layer.empty)
  .live('each scenario drives the real engine in-process over a checker plugin and the vm test runner')
  .body(({ scenario }) => {
    scenario(
      'A checker ignores the dominator, so the subsumed mutant runs and names why it was re-admitted',
      Gherkin.Do.pipe(
        Given('a covered relational site whose dominator a checker ignores')(
          'results',
          () => runWorkspace(COVERED_WORKSPACE_FILES, [{ plugin: CHECKER_PLUGIN }]),
        ),
        Then(
          'the subsumed mutant carries a readmission and no redundancy, ran instead of staying Ignored, and names the ignored dominator',
        )((s, expect) => {
          const subsumed = s.results.find((result) => result.readmission !== undefined)
          const cause = subsumed?.readmission?.causes[0]
          const dominator = s.results.find((result) => result.id === cause?.dominator)
          return expect({
            carriesReadmissionWithoutRedundancy: subsumed !== undefined && subsumed.redundancy === undefined,
            ranItsOwnPlan: subsumed !== undefined && subsumed.status !== 'Ignored' && subsumed.status !== 'NoCoverage',
            causeNamesIgnoredDominator: cause?.code === 'dominator-ignored-at-check',
            dominatorWasIgnoredAtCheck: dominator?.status === 'Ignored',
          }).toEqual({
            carriesReadmissionWithoutRedundancy: true,
            ranItsOwnPlan: true,
            causeNamesIgnoredDominator: true,
            dominatorWasIgnoredAtCheck: true,
          })
        }),
      ),
    )

    scenario(
      'Without a checker the dominator runs, so the subsumed mutant stays Ignored with the redundancy reason',
      Gherkin.Do.pipe(
        Given('a covered relational site and no checker')('results', () => runWorkspace(COVERED_WORKSPACE_FILES, [])),
        Then('the subsumed mutant is Ignored with a reason rendered from its redundancy and names a running dominator')(
          (s, expect) => {
            const subsumed = s.results.find((result) => result.redundancy !== undefined)
            const redundancy = subsumed?.redundancy
            return expect({
              isIgnored: subsumed?.status === 'Ignored',
              reasonIsTheRedundancyReason: redundancy !== undefined &&
                subsumed?.statusReason === Mutant.redundancyStatusReason(redundancy),
              namesADominatorThatRan: redundancy !== undefined &&
                s.results.some((result) =>
                  result.id === redundancy.dominators[0] &&
                  (result.status === 'Killed' || result.status === 'Survived')
                ),
            }).toEqual({
              isIgnored: true,
              reasonIsTheRedundancyReason: true,
              namesADominatorThatRan: true,
            })
          },
        ),
      ),
    )

    scenario(
      'No test covers the site, so a re-admitted subsumed mutant settles NoCoverage',
      Gherkin.Do.pipe(
        Given('a relational site no test reaches whose dominator a checker ignores')(
          'results',
          () => runWorkspace(UNCOVERED_WORKSPACE_FILES, [{ plugin: CHECKER_PLUGIN }]),
        ),
        Then('the subsumed mutant is re-admitted and settles NoCoverage, naming the ignored dominator')(
          (s, expect) => {
            const subsumed = s.results.find((result) => result.readmission !== undefined)
            return expect({
              readmittedAsNoCoverage: subsumed?.status === 'NoCoverage',
              namesTheIgnoredDominator: subsumed?.readmission?.causes[0]?.code === 'dominator-ignored-at-check',
            }).toEqual({ readmittedAsNoCoverage: true, namesTheIgnoredDominator: true })
          },
        ),
      ),
    )
  })
