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

const DYNAMIC_SPEC = 'src/dynamic-user.spec.ts'
const STATIC_SPEC = 'src/static-only.spec.ts'
const RUNTIME_ONLY = 'src/runtime-only.ts'

const PROJECT_FILES: Readonly<Record<string, string>> = {
  'package.json': '{\n  "name": "dynamic-evidence-fixture",\n  "private": true,\n  "type": "module"\n}\n',
  [RUNTIME_ONLY]: 'export const value = 7\n',
  [DYNAMIC_SPEC]: [
    "import { expect, test } from 'vitest'",
    '',
    "test('loads the runtime-only module', async () => {",
    "  const specifier = './runtime-only.js'",
    '  const loaded = await import(/* @vite-ignore */ specifier)',
    '  expect(loaded.value).toBe(7)',
    '})',
    '',
  ].join('\n'),
  [STATIC_SPEC]: [
    "import { expect, test } from 'vitest'",
    '',
    "test('never loads the runtime-only module', () => {",
    '  expect(1).toBe(1)',
    '})',
    '',
  ].join('\n'),
}

interface RunOverride {
  readonly pool?: 'threads'
}

const contextFor = (
  options: Plugin.TestRunnerBuildContext['options'],
  root: string,
  override: RunOverride,
): Plugin.TestRunnerBuildContext => ({
  options: {
    ...options,
    testRunner: {
      plugin: 'vitest',
      options: {
        related: false,
        ...Option.match(Option.fromNullishOr(override.pool), {
          onNone: () => ({}),
          onSome: (pool) => ({ pool }),
        }),
      },
    },
  },
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
      const root = yield* fs.realPath(yield* fs.makeTempDirectory({ prefix: 'dynamic-evidence-' }))
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

const runDryRun = (
  override: RunOverride,
): Effect.Effect<
  { readonly root: string; readonly result: TestRunner.DryRunResult },
  never,
  FileSystem.FileSystem | Path.Path
> =>
  withProject((root) =>
    Effect.gen(function*() {
      const options = yield* Configuration.createDefaultOptions
      const context = contextFor(options, root, override)
      const runner = yield* Plugin.buildTestRunner(context, vitestChildRunner(context))
      const result = yield* runner.dryRun({ timeout: 60_000, coverageAnalysis: 'perTest', disableBail: true })
      return { root, result }
    })
  ).pipe(Effect.provide(Engine.nodePlatformLayer), Effect.scoped, Effect.orDie)

const evidenceOf = (
  outcome: { readonly root: string; readonly result: TestRunner.DryRunResult },
): Effect.Effect<
  {
    readonly status: TestRunner.DryRunResult['status']
    readonly dynamicHasRuntimeOnly: boolean
    readonly staticHasRuntimeOnly: boolean
  },
  never,
  Path.Path
> =>
  Effect.gen(function*() {
    const path = yield* Path.Path
    const modules = outcome.result.status === 'complete' ? outcome.result.testFileModules : undefined
    const runtimeOnly = path.join(outcome.root, RUNTIME_ONLY)
    return {
      status: outcome.result.status,
      dynamicHasRuntimeOnly: modules?.[path.join(outcome.root, DYNAMIC_SPEC)]?.includes(runtimeOnly) ?? false,
      staticHasRuntimeOnly: modules?.[path.join(outcome.root, STATIC_SPEC)]?.includes(runtimeOnly) ?? false,
    }
  })

const EXPECTED = { status: 'complete' as const, dynamicHasRuntimeOnly: true, staticHasRuntimeOnly: false }

Feature('Reporting the modules each test file evaluated during the dry run')
  .withLayer(Engine.nodePlatformLayer)
  .live('each scenario starts a real vitest runner worker over a real project on disk')
  .body(({ scenario }) => {
    scenario(
      'A runtime import is evidence for the file that ran it and for no other',
      Gherkin.Do.pipe(
        Given('a project whose only runtime import lives in one test file')(
          'project',
          () => Effect.succeed({ dynamic: DYNAMIC_SPEC, static: STATIC_SPEC }),
        ),
        When('the dry run completes')('outcome', () => runDryRun({}).pipe(Effect.flatMap(evidenceOf))),
        Then('only that test file names the runtime-only module')((s, expect) => expect(s.outcome).toEqual(EXPECTED)),
      ),
    )

    scenario(
      'The vm runner pool reports the same evidence',
      Gherkin.Do.pipe(
        Given('a project whose only runtime import lives in one test file')(
          'project',
          () => Effect.succeed({ dynamic: DYNAMIC_SPEC, static: STATIC_SPEC }),
        ),
        When('the dry run completes on the standby threads pool')(
          'outcome',
          () => runDryRun({ pool: 'threads' }).pipe(Effect.flatMap(evidenceOf)),
        ),
        Then('only that test file names the runtime-only module')((s, expect) => expect(s.outcome).toEqual(EXPECTED)),
      ),
    )
  })
