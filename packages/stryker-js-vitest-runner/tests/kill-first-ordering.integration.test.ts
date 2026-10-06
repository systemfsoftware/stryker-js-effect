import { Gherkin, Given, it, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import { Configuration, Engine, Plugin } from '@systemfsoftware/stryker-js'
import { Mutant, TestRunner } from '@systemfsoftware/stryker-js-plugin-interface'
import { strykerPlugins as vitestRunnerPlugins } from '@systemfsoftware/stryker-js-vitest-runner'
import * as Arr from 'effect/Array'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as Option from 'effect/Option'
import * as Path from 'effect/Path'

const Feature = makeFeature({ it })

const PACKAGE_ROOT = decodeURIComponent(new URL('..', import.meta.url).pathname)

const PROJECT_FILES: Readonly<Record<string, string>> = {
  'package.json': '{\n  "name": "kill-first-fixture",\n  "private": true,\n  "type": "module"\n}\n',
  'src/math.ts':
    'export const add = (left: number, right: number): number => left + right\n\nexport const subtract = (left: number, right: number): number => left - right\n',
  'src/aaa.spec.ts': [
    "import { expect, test } from 'vitest'",
    "import { add } from './math.js'",
    '',
    "test('aaa addition', () => {",
    '  expect(add(1, 2)).toBe(3)',
    '})',
    '',
  ].join('\n'),
  'src/zzz.spec.ts': [
    "import { expect, test } from 'vitest'",
    "import { subtract } from './math.js'",
    '',
    "test('zzz subtraction kills', () => {",
    '  expect(subtract(5, 2)).toBe(999)',
    '})',
    '',
  ].join('\n'),
}

const ADDITION = 'src/aaa.spec.ts#aaa addition'
const KILLER = 'src/zzz.spec.ts#zzz subtraction kills'

const ACTIVE_MUTANT = Mutant.Mutant.make({
  id: Mutant.MutantId.make('0000000000000001'),
  fileName: Mutant.CanonicalFileName.make('src/math.ts'),
  mutatorName: Mutant.MutatorName.make('ArithmeticOperator'),
  replacement: '-',
  location: { start: { line: 3, column: 47 }, end: { line: 3, column: 48 } },
})

interface RunOverride {
  readonly testFilter?: readonly string[]
  readonly priorKillerTestIds?: readonly string[]
}

const contextFor = (
  options: Plugin.TestRunnerBuildContext['options'],
  root: string,
): Plugin.TestRunnerBuildContext => ({
  options: { ...options, testRunner: { plugin: 'vitest', options: { related: false } } },
  fileDescriptions: {},
  sandboxWorkingDirectory: root,
  idGenerator: { next: Effect.succeed(1) },
  retire: Effect.void,
  testFiles: [],
})

const vitestChildRunner = (context: Plugin.TestRunnerBuildContext) =>
  Arr.head(vitestRunnerPlugins).pipe(
    Option.map((runner) =>
      Plugin.makeChildProcessTestRunner({
        options: context.options,
        fileDescriptions: context.fileDescriptions,
        sandboxWorkingDirectory: context.sandboxWorkingDirectory,
        workerEntrypoint: runner.workerEntry,
        idGenerator: context.idGenerator,
      })
    ),
    Option.getOrElse(() => Effect.die(new Error('the vitest runner plugin descriptor is missing'))),
  )

const withProject = <A, E, R>(
  use: (root: string) => Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R | FileSystem.FileSystem | Path.Path> =>
  Effect.acquireUseRelease(
    Effect.gen(function*() {
      const fs = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const root = yield* fs.realPath(yield* fs.makeTempDirectory({ prefix: 'kill-first-' }))
      yield* fs.makeDirectory(path.join(root, 'src'), { recursive: true })
      yield* Effect.forEach(Object.entries(PROJECT_FILES), ([name, content]) =>
        fs.writeFileString(path.join(root, name), content))
      yield* fs.symlink(path.join(PACKAGE_ROOT, 'node_modules'), path.join(root, 'node_modules'))
      return root
    }),
    use,
    (root) =>
      Effect.flatMap(FileSystem.FileSystem, (fs) => fs.remove(root, { recursive: true, force: true })),
  ).pipe(Effect.orDie)

const runMutant = (
  override: RunOverride,
): Effect.Effect<TestRunner.MutantRunResult, never, FileSystem.FileSystem | Path.Path> =>
  withProject((root) =>
    Effect.gen(function*() {
      const options = yield* Configuration.createDefaultOptions
      const context = contextFor(options, root)
      const runner = yield* Plugin.buildTestRunner(context, vitestChildRunner(context))
      return yield* runner.mutantRun({
        activeMutant: ACTIVE_MUTANT,
        sandboxFileName: 'src/math.ts',
        mutantActivation: 'runtime',
        reloadEnvironment: false,
        timeout: 60_000,
        disableBail: false,
        ...override,
      })
    })
  ).pipe(Effect.provide(Engine.nodePlatformLayer), Effect.scoped, Effect.orDie)

const verdictOf = (result: TestRunner.MutantRunResult) => ({
  status: result.status,
  killedBy: result.status === 'killed' ? result.killedBy : [],
  executedTests: result.status === 'killed' ? result.executedTests.map((test) => test.id) : [],
})

Feature("Ordering each mutant's tests so its killer runs first")
  .withLayer(Engine.nodePlatformLayer)
  .live('each scenario starts a real vitest runner worker over a real project on disk')
  .body(({ scenario }) => {
    scenario(
      'A run filtered to the killing test first stops on its kill',
      Gherkin.Do.pipe(
        Given('a project whose killer test lives in the later test file')(
          'project',
          () => Effect.succeed({ killer: KILLER, addition: ADDITION }),
        ),
        When('the run filters to the killing test first')(
          'outcome',
          () => runMutant({ testFilter: [KILLER, ADDITION] }),
        ),
        Then('only the killing test is recorded and the mutant is killed')((s, expect) =>
          expect(verdictOf(s.outcome)).toEqual({
            status: 'killed',
            killedBy: [KILLER],
            executedTests: [KILLER],
          })
        ),
      ),
    )

    scenario(
      'A run that starts from the previously recorded killer stops on its kill',
      Gherkin.Do.pipe(
        Given('a project with no filter but a previously recorded killer')(
          'project',
          () => Effect.succeed({ killer: KILLER }),
        ),
        When('the run names the previous killer without a filter')(
          'outcome',
          () => runMutant({ priorKillerTestIds: [KILLER] }),
        ),
        Then('the killer runs first and the run stops on its kill')((s, expect) =>
          expect(verdictOf(s.outcome)).toEqual({
            status: 'killed',
            killedBy: [KILLER],
            executedTests: [KILLER],
          })
        ),
      ),
    )

    scenario(
      'The verdict does not depend on where the killer sits in the filter',
      Gherkin.Do.pipe(
        Given('a project whose two covering tests both run the mutant')(
          'project',
          () => Effect.succeed({ killer: KILLER, addition: ADDITION }),
        ),
        When('the same mutant runs with the killer leading and with it trailing')('verdicts', (s) =>
          Effect.all([
            runMutant({ testFilter: [s.project.killer, s.project.addition] }),
            runMutant({ testFilter: [s.project.addition, s.project.killer] }),
          ]).pipe(
            Effect.map(([leading, trailing]) => ({ leading: verdictOf(leading), trailing: verdictOf(trailing) })),
          )),
        Then('both orders settle the same verdict')((s, expect) =>
          expect({
            leading: { status: s.verdicts.leading.status, killedBy: s.verdicts.leading.killedBy },
            trailing: { status: s.verdicts.trailing.status, killedBy: s.verdicts.trailing.killedBy },
          }).toEqual({
            leading: { status: 'killed', killedBy: [KILLER] },
            trailing: { status: 'killed', killedBy: [KILLER] },
          })
        ),
      ),
    )
  })
