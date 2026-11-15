import { Gherkin, Given, it, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import { Configuration, Engine, Plugin } from '@systemfsoftware/stryker-js'
import { TestRunner } from '@systemfsoftware/stryker-js-plugin-interface'
import { strykerPlugins as vitestRunnerPlugins } from '@systemfsoftware/stryker-js-vitest-runner'
import * as Arr from 'effect/Array'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as Option from 'effect/Option'
import * as Path from 'effect/Path'

const Feature = makeFeature({ it })

const PACKAGE_ROOT = decodeURIComponent(new URL('..', import.meta.url).pathname)

const PROJECT_FILES: Readonly<Record<string, string>> = {
  'package.json': '{\n  "name": "test-status-fixture",\n  "private": true,\n  "type": "module"\n}\n',
  'src/modifiers.spec.ts': [
    "import { expect, test } from 'vitest'",
    '',
    "test('plain passing', () => expect(1).toBe(1))",
    "test('plain failing', () => expect(1).toBe(2))",
    "test.fails('expected failure that fails', () => expect(1).toBe(2))",
    "test.fails('expected failure that passes', () => expect(1).toBe(1))",
    "test.skip('skipped', () => expect(1).toBe(2))",
    "test.todo('todo')",
    "test.each([1, 2])('each %i', (value) => expect(value).toBe(value))",
    '',
  ].join('\n'),
  'src/hook-throws.spec.ts': [
    "import { beforeAll, expect, test } from 'vitest'",
    '',
    "beforeAll(() => { throw new Error('setup failed') })",
    "test('behind a throwing beforeAll', () => expect(1).toBe(1))",
    '',
  ].join('\n'),
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
      const root = yield* fs.realPath(yield* fs.makeTempDirectory({ prefix: 'test-statuses-' }))
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

const statusesByName = (root: string, result: TestRunner.DryRunResult): Readonly<Record<string, string>> =>
  result.status === 'complete'
    ? Object.fromEntries(
      [...result.tests]
        .map((test) =>
          [test.name.startsWith(`${root}/`) ? test.name.slice(root.length + 1) : test.name, test.status] as const
        )
        .sort(([a], [b]) => a.localeCompare(b)),
    )
    : { [`dry run ${result.status}`]: 'none' }

const dryRunStatuses: Effect.Effect<Readonly<Record<string, string>>, never, FileSystem.FileSystem | Path.Path> =
  withProject((root) =>
    Effect.gen(function*() {
      const options = yield* Configuration.createDefaultOptions
      const context = contextFor(options, root)
      const runner = yield* Plugin.buildTestRunner(context, vitestChildRunner(context))
      const result = yield* runner.dryRun({ timeout: 60_000, coverageAnalysis: 'off', disableBail: true })
      return statusesByName(root, result)
    })
  ).pipe(Effect.provide(Engine.nodePlatformLayer), Effect.scoped, Effect.orDie)

const EXPECTED: Readonly<Record<string, string>> = {
  'behind a throwing beforeAll': 'skipped',
  'each 1': 'success',
  'each 2': 'success',
  'expected failure that fails': 'success',
  'expected failure that passes': 'failed',
  'plain failing': 'failed',
  'plain passing': 'success',
  'skipped': 'skipped',
  'src/hook-throws.spec.ts': 'failed',
  'todo': 'skipped',
}

Feature('Reporting the status vitest gives each kind of test')
  .withLayer(Engine.nodePlatformLayer)
  .live('the scenario starts a real vitest runner worker over a fixed project on disk')
  .body(({ scenario }) => {
    scenario(
      'Each test modifier reaches the dry run with the status vitest gave it',
      Gherkin.Do.pipe(
        Given('a project with one test per vitest modifier and a file whose beforeAll throws')(
          'files',
          () => Effect.succeed(Object.keys(PROJECT_FILES)),
        ),
        When('the dry run completes')('statuses', () => dryRunStatuses),
        Then('every test carries the status vitest gave it, and a file failed by its hook is one failed test')((
          s,
          expect,
        ) => expect(s.statuses).toEqual(EXPECTED)),
      ),
    )
  })
