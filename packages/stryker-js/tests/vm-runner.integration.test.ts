import { Gherkin, Given, it, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import { Configuration, Engine, Plugin } from '@systemfsoftware/stryker-js'
import type { Options } from '@systemfsoftware/stryker-js-plugin-interface'
import { strykerPlugins as vmRunnerPlugins } from '@systemfsoftware/stryker-js-vm-runner'
import * as Arr from 'effect/Array'
import * as Cause from 'effect/Cause'
import * as Effect from 'effect/Effect'
import * as Exit from 'effect/Exit'
import * as FileSystem from 'effect/FileSystem'
import * as Option from 'effect/Option'
import * as Path from 'effect/Path'

const Feature = makeFeature({ it })

const PACKAGE_ROOT = decodeURIComponent(new URL('..', import.meta.url).pathname)
const BROWSER_FIXTURE_SEGMENTS: readonly [string, string] = ['testResources', 'vm-browser']

const withBrowserProject = <A, E, R>(
  use: (root: string) => Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R | FileSystem.FileSystem | Path.Path> =>
  Effect.acquireUseRelease(
    Effect.gen(function*() {
      const fs = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const root = yield* fs.realPath(yield* fs.makeTempDirectory({ prefix: 'vm-browser-' }))
      yield* fs.copy(path.join(PACKAGE_ROOT, ...BROWSER_FIXTURE_SEGMENTS), root, { overwrite: true })
      yield* fs.symlink(path.join(PACKAGE_ROOT, 'node_modules'), path.join(root, 'node_modules'))
      return root
    }).pipe(Effect.orDie),
    use,
    (root) =>
      Effect.flatMap(FileSystem.FileSystem, (fs) => fs.remove(root, { recursive: true, force: true })).pipe(
        Effect.orDie,
      ),
  )

const contextFor = (options: Options.StrykerOptions, root: string): Plugin.TestRunnerBuildContext => ({
  options: { ...options, testRunner: 'vm' },
  fileDescriptions: {},
  sandboxWorkingDirectory: root,
  idGenerator: { next: Effect.succeed(1) },
  retire: Effect.void,
  testFiles: [],
})

const vmDryRunOutcome = (root: string): Effect.Effect<string, never, Engine.EnginePorts> =>
  Effect.gen(function*() {
    const context = contextFor(yield* Configuration.createDefaultOptions, root)
    const childRunner = Arr.head(vmRunnerPlugins).pipe(
      Option.map((runner) =>
        Plugin.makeChildProcessTestRunner({
          options: context.options,
          fileDescriptions: context.fileDescriptions,
          sandboxWorkingDirectory: context.sandboxWorkingDirectory,
          workerEntrypoint: runner.workerEntry,
          idGenerator: context.idGenerator,
        })
      ),
      Option.getOrElse(() => Effect.die(new Error('the vm runner plugin descriptor is missing'))),
    )
    const exit = yield* Plugin.buildTestRunner(context, childRunner).pipe(
      Effect.flatMap((runner) => runner.dryRun({ timeout: 60_000, coverageAnalysis: 'off', disableBail: true })),
      Effect.scoped,
      Effect.exit,
    )
    return Exit.match(exit, {
      onFailure: (cause) => Cause.pretty(cause),
      onSuccess: (result) => JSON.stringify(result),
    })
  })

Feature('Running mutation tests with the vm test runner')
  .withLayer(Engine.nodePlatformLayer)
  .live('each scenario reads the real install layout or starts a real vitest runner worker')
  .body(({ scenario }) => {
    scenario(
      'A config that names no test runner runs the vm runner',
      Gherkin.Do.pipe(
        Given('Stryker configured without a test runner')('options', () => Configuration.createDefaultOptions),
        Then('the run selects the vm runner')((s, expect) => expect(s.options.testRunner).toBe('vm')),
      ),
    )

    scenario(
      'The vm runner comes from the Stryker install, not the project install',
      Gherkin.Do.pipe(
        Given('the plugin Stryker resolves for the vm runner')(
          'plugin',
          () =>
            Effect.gen(function*() {
              const fs = yield* FileSystem.FileSystem
              const path = yield* Path.Path
              const url = Plugin.vmRunnerPluginUrl()
              const filePath = yield* path.fromFileUrl(new URL(url))
              return { url, exists: yield* fs.exists(filePath) }
            }),
        ),
        Then('it points at a linked vitest runner package that exists on disk')((s, expect) =>
          expect({
            isFileUrl: s.plugin.url.startsWith('file://'),
            namesVitestRunner: s.plugin.url.includes('stryker-js-vitest-runner'),
            exists: s.plugin.exists,
          }).toEqual({ isFileUrl: true, namesVitestRunner: true, exists: true })
        ),
      ),
    )

    scenario(
      'A project that picks its own test runner keeps that choice',
      Gherkin.Do.pipe(
        Given('Stryker configured with a custom test runner')(
          'configured',
          () => Effect.succeed({ plugin: 'file:///project/runner.mjs', options: { dir: 'test' } } as const),
        ),
        Then('the engine leaves the configured runner untouched')((s, expect) =>
          expect(Plugin.testRunnerConfigOf(s.configured)).toEqual(s.configured)
        ),
      ),
    )

    scenario(
      'A browser-mode project is refused by the vm runner and pointed at the vitest runner',
      Gherkin.Do.pipe(
        When('a vm dry run starts on a project whose Vitest config enables browser mode')(
          'outcome',
          () => withBrowserProject(vmDryRunOutcome),
        ),
        Then('the run fails before any test runs, naming the vitest runner')((s, expect) =>
          expect(s.outcome).toContain("testRunner: 'vitest'")
        ),
      ),
    )
  })
