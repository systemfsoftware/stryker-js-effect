import { Gherkin, Given, it, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import { Configuration, Engine, Plugin } from '@systemfsoftware/stryker-js'
import type { Options } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Cause from 'effect/Cause'
import * as Effect from 'effect/Effect'
import * as Exit from 'effect/Exit'
import * as FileSystem from 'effect/FileSystem'
import * as Match from 'effect/Match'
import * as Path from 'effect/Path'

const Feature = makeFeature({ it })

const CHILD_RUNNER_USED = 'the child-process test runner was built'

const childRunnerProbe = Effect.suspend(() => Effect.die(new Error(CHILD_RUNNER_USED)))

const contextWith = (
  options: Options.StrykerOptions,
): {
  readonly options: Options.StrykerOptions
  readonly fileDescriptions: Record<string, never>
  readonly sandboxWorkingDirectory: string
  readonly idGenerator: { readonly next: Effect.Effect<number> }
  readonly retire: Effect.Effect<void>
  readonly testFiles: readonly string[]
} => ({
  options,
  fileDescriptions: {},
  sandboxWorkingDirectory: '/project',
  idGenerator: { next: Effect.succeed(1) },
  retire: Effect.void,
  testFiles: [],
})

const buildVmRunner = (options: Options.StrykerOptions): Effect.Effect<string, never, Engine.EnginePorts> =>
  Effect.gen(function*() {
    const exit = yield* Plugin.buildTestRunner(contextWith(options), childRunnerProbe).pipe(Effect.exit, Effect.scoped)
    return Match.value(exit).pipe(
      Match.when(Exit.isFailure, (failure) => Cause.pretty(failure.cause)),
      Match.orElse(() => 'the child-process runner was never built'),
    )
  })

Feature('Running mutation tests with the vm test runner')
  .withLayer(Engine.nodePlatformLayer)
  .live('each scenario reads the real install layout and builds the real child-process runner path')
  .body(({ scenario }) => {
    scenario(
      'A config that names no test runner runs the vm runner',
      Gherkin.Do.pipe(
        Given('Stryker configured without a test runner')('options', () => Configuration.createDefaultOptions),
        Then('the run selects the vm runner')((s, expect) => expect(s.options.testRunner).toBe('vm')),
      ),
    )

    scenario(
      'The vm runner is the vitest runner on the isolated threads pool',
      Gherkin.Do.pipe(
        Given('Stryker configured without a test runner')('options', () => Configuration.createDefaultOptions),
        When('the engine resolves the runner to build')(
          'resolved',
          (s) => Effect.sync(() => Plugin.testRunnerConfigOf(s.options.testRunner)),
        ),
        Then('the resolved runner is the vitest runner pinned to the threads pool')((s, expect) =>
          expect(s.resolved).toEqual({ plugin: Plugin.vmRunnerPluginUrl(), options: { pool: 'threads' } })
        ),
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
      'A vm run builds a child-process runner rather than an in-process one',
      Gherkin.Do.pipe(
        Given('Stryker configured without a test runner')('options', () => Configuration.createDefaultOptions),
        When('the engine builds the runner for a vm run')('outcome', (s) => buildVmRunner(s.options)),
        Then('the child-process runner is built')((s, expect) => expect(s.outcome).toContain(CHILD_RUNNER_USED)),
      ),
    )
  })
