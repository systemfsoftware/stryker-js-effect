import { NodeFileSystem, NodePath } from '@effect/platform-node'
import { Gherkin, Given, it, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
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

const CHECKER_PLUGIN = new URL('./__fixtures__/subsumption-checker/index.mjs', import.meta.url).href
const COMPILE_ERROR_CHECKER_PLUGIN = new URL('./__fixtures__/subsumption-checker/compile-error.mjs', import.meta.url)
  .href

const SUBSUMED_FILE = 'src/lib/subsumed.ts'
const UNCOVERED_FILE = 'src/lib/uncovered.ts'
const COVERED_FILE = 'src/lib/covered.ts'
const STATIC_FILE = 'src/lib/static.ts'

const RELATIONAL_SOURCE = 'export const less = (a: number, b: number): number => a < b ? 1 : 0\n'
const STATIC_SOURCE = 'const a: number = 1\nconst b: number = 2\nexport const ordered = a < b ? 1 : 0\n'
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

const STATIC_TEST_SOURCE = [
  "import { expect, test } from 'vitest'",
  `import { ordered } from '../${STATIC_FILE}'`,
  '',
  "test('orders two constants', () => {",
  '  expect(ordered).toBe(1)',
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

const runEngine = (
  directory: string,
  checkers: readonly CheckerSpec[],
  extras: Options.PartialStrykerOptions,
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
        cliOptions: cliOptionsOf(directory, checkers, extras),
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
  extras: Options.PartialStrykerOptions = {},
  runs = 1,
): Effect.Effect<readonly Mutant.RunMutantResult[], never, never> =>
  Effect.gen(function*() {
    const workspace = yield* writeWorkspace(files)
    const optionsOf = (directory: string): Options.PartialStrykerOptions => ({
      ...extras,
      ...(extras.incremental === true ? { incrementalFile: `${directory}/reports/stryker-incremental.json` } : {}),
    })
    const lastRun = Effect.forEach(
      Array.from({ length: runs }),
      () => runEngine(workspace.directory, checkers, optionsOf(workspace.directory)),
      { concurrency: 1 },
    ).pipe(Effect.map((all) => all.at(-1) ?? []))
    return yield* Effect.ensuring(lastRun, removeWorkspace(workspace.directory))
  }).pipe(Effect.orDie, Effect.provide(filePorts))

const runRestrictedToSubsumed = (
  files: ReadonlyArray<readonly [string, string]>,
): Effect.Effect<readonly Mutant.RunMutantResult[], never, never> =>
  Effect.gen(function*() {
    const workspace = yield* writeWorkspace(files)
    const restricted = Effect.gen(function*() {
      const first = yield* runEngine(workspace.directory, [], {})
      const subsumedIds = first.filter((result) => subsumedOf(result) !== undefined).map((result) => result.id)
      return yield* runEngine(workspace.directory, [], { mutantIds: subsumedIds })
    })
    return yield* Effect.ensuring(restricted, removeWorkspace(workspace.directory))
  }).pipe(Effect.orDie, Effect.provide(filePorts))

const readmittedOf = (result: Mutant.RunMutantResult): Mutant.Readmitted | undefined =>
  S.is(Mutant.Readmitted)(result.subsumption) ? result.subsumption : undefined

const subsumedOf = (result: Mutant.RunMutantResult): Mutant.Subsumed | undefined =>
  S.is(Mutant.Subsumed)(result.subsumption) ? result.subsumption : undefined

const SUBSUMED_REASON =
  "redundant-relational: subsumed by <dominator> (complement): every test that kills <dominator> kills this mutant, so act on <dominator>, or set mutator.mutantSetPolicy 'full' to run it"

const readmissionCauseOf = (results: readonly Mutant.RunMutantResult[]) => {
  const readmitted = results.find((result) => readmittedOf(result) !== undefined)
  const cause = readmitted === undefined ? undefined : readmittedOf(readmitted)?.causes[0]
  const dominator = results.find((result) => result.id === cause?.dominator)
  return {
    readmittedStatus: readmitted?.status,
    causeCode: cause?.code,
    dominatorStatus: dominator?.status,
  }
}

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

const STATIC_WORKSPACE_FILES: ReadonlyArray<readonly [string, string]> = [
  ['vitest.config.ts', VITEST_CONFIG_SOURCE],
  [STATIC_FILE, STATIC_SOURCE],
  ['test/sample.test.mjs', STATIC_TEST_SOURCE],
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
        Then('the subsumed mutant ran and names the dominator the checker ignored')((s, expect) =>
          expect(readmissionCauseOf(s.results)).toEqual({
            readmittedStatus: 'Killed',
            causeCode: 'dominator-ignored-at-check',
            dominatorStatus: 'Ignored',
          })
        ),
      ),
    )

    scenario(
      'A checker fails the dominator to compile, so the subsumed mutant runs and names the compile error',
      Gherkin.Do.pipe(
        Given('a covered relational site whose dominator a checker reports as a compile error')(
          'results',
          () => runWorkspace(COVERED_WORKSPACE_FILES, [{ plugin: COMPILE_ERROR_CHECKER_PLUGIN }]),
        ),
        Then('the subsumed mutant ran and names the dominator that did not compile')((s, expect) =>
          expect(readmissionCauseOf(s.results)).toEqual({
            readmittedStatus: 'Killed',
            causeCode: 'dominator-compile-error',
            dominatorStatus: 'CompileError',
          })
        ),
      ),
    )

    scenario(
      'An incremental rerun remembers the ignored dominator, so the subsumed mutant runs again',
      Gherkin.Do.pipe(
        Given('a covered relational site whose dominator a checker ignores, run twice incrementally')(
          'results',
          () => runWorkspace(COVERED_WORKSPACE_FILES, [{ plugin: CHECKER_PLUGIN }], { incremental: true }, 2),
        ),
        Then('the second run re-admits the subsumed mutant behind the remembered dominator')((s, expect) =>
          expect(readmissionCauseOf(s.results)).toEqual({
            readmittedStatus: 'Killed',
            causeCode: 'dominator-remembered-without-running',
            dominatorStatus: 'Ignored',
          })
        ),
      ),
    )

    scenario(
      'Without a checker the dominator runs, so the subsumed mutant stays Ignored with the subsumption reason',
      Gherkin.Do.pipe(
        Given('a covered relational site and no checker')('results', () => runWorkspace(COVERED_WORKSPACE_FILES, [])),
        Then('the subsumed mutant is Ignored with the subsumption reason and names a dominator that ran')(
          (s, expect) => {
            const subsumed = s.results.find((result) => subsumedOf(result) !== undefined)
            const dominatorId = subsumed === undefined ? undefined : subsumedOf(subsumed)?.dominators[0]
            return expect({
              status: subsumed?.status,
              reason: dominatorId === undefined
                ? undefined
                : subsumed?.statusReason?.replaceAll(dominatorId, '<dominator>'),
              dominatorStatus: s.results.find((result) => result.id === dominatorId)?.status,
            }).toEqual({ status: 'Ignored', reason: SUBSUMED_REASON, dominatorStatus: 'Survived' })
          },
        ),
      ),
    )

    scenario(
      'A rerun that asks for only the subsumed mutant leaves its dominator out, so the subsumed mutant runs',
      Gherkin.Do.pipe(
        Given('a relational comparison that a test covers')('files', () => Effect.succeed(COVERED_WORKSPACE_FILES)),
        When('a rerun asks for only the mutant its first run subsumed')(
          'results',
          (s) => runRestrictedToSubsumed(s.files),
        ),
        Then('the subsumed mutant runs and names its dominator as not settled in that run')((s, expect) =>
          expect({
            ...readmissionCauseOf(s.results),
            ranIds: s.results.length,
          }).toEqual({
            readmittedStatus: 'Killed',
            causeCode: 'dominator-unsettled',
            dominatorStatus: undefined,
            ranIds: 1,
          })
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
          (s, expect) =>
            expect(readmissionCauseOf(s.results)).toEqual({
              readmittedStatus: 'NoCoverage',
              causeCode: 'dominator-ignored-at-check',
              dominatorStatus: 'Ignored',
            }),
        ),
      ),
    )

    scenario(
      'A static relational site under ignoreStatic keeps the static reason, because its dominator does not run either',
      Gherkin.Do.pipe(
        Given('a relational comparison evaluated at module load, with ignoreStatic on')(
          'results',
          () => runWorkspace(STATIC_WORKSPACE_FILES, [], { ignoreStatic: true }),
        ),
        Then('every ordering mutant at the site is Ignored as static and none carries a subsumption reference')(
          (s, expect) => {
            const ordering = s.results.filter((result) => result.mutatorName === 'EqualityOperator')
            return expect({
              statuses: [...new Set(ordering.map((result) => `${result.status}: ${result.statusReason ?? ''}`))],
              references: ordering.filter((result) => result.subsumption !== undefined).length,
            }).toEqual({
              statuses: ['Ignored: ignore-static: Static mutant (and "ignoreStatic" was enabled)'],
              references: 0,
            })
          },
        ),
      ),
    )
  })
