import { Gherkin, Given, it, layer, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import { create, loadPlugins } from '@systemfsoftware/stryker-js-engine/plugin-loader'
import type { LoadedPlugins } from '@systemfsoftware/stryker-js-engine/plugin-loader'
import { Module } from '@systemfsoftware/stryker-js-language'
import * as Array from 'effect/Array'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as Layer from 'effect/Layer'
import * as Logger from 'effect/Logger'
import * as Option from 'effect/Option'
import * as Path from 'effect/Path'
import * as Result from 'effect/Result'
import { expect } from 'vitest'

const Feature = makeFeature({ it, layer })

const PROJECT = '/project'
const PROJECT_MANIFEST = `${PROJECT}/package.json`
const FIXTURES_DIR = `${process.cwd()}/tests/__fixtures__`

const LOCAL_PLUGIN = './local-plugin.js'
const RUNNER = '@acme/stryker-runner'
const UNSHIPPED = '@acme/stryker-unshipped'
const RUNNER_LATE = '@acme/stryker-runner-late'
const DUPLICATE_RUNNER = '@acme/stryker-runner-duplicate'

const fixtureManifest = (directory: string): string => `${FIXTURES_DIR}/${directory}/package.json`
const fixtureEntrypoint = (directory: string): string => `file://${FIXTURES_DIR}/${directory}/index.mjs`

const RUNNER_MANIFEST = fixtureManifest('plugin-runner')
const RUNNER_LATE_MANIFEST = fixtureManifest('plugin-runner-late')
const DUPLICATE_RUNNER_MANIFEST = fixtureManifest('plugin-runner-duplicate')

const RUNNER_ENTRYPOINT = fixtureEntrypoint('plugin-runner')
const RUNNER_LATE_ENTRYPOINT = fixtureEntrypoint('plugin-runner-late')
const DUPLICATE_RUNNER_ENTRYPOINT = fixtureEntrypoint('plugin-runner-duplicate')

const VITEST_WORKER_ENTRY = 'file:///project/node_modules/@acme/stryker-runner/dist/main.mjs'

interface Installations {
  readonly [specifier: string]: string | undefined
}

interface ResolverState {
  readonly bases: string[]
  readonly attempted: string[]
  readonly warnings: string[]
}

interface LoadOutcome {
  readonly result: Result.Result<LoadedPlugins, unknown>
  readonly state: ResolverState
}

const freshState = (): ResolverState => ({ bases: [], attempted: [], warnings: [] })

const moduleLayer = (
  state: ResolverState,
  installations: Installations,
): Layer.Layer<Module> =>
  Layer.succeed(Module, {
    findPackageJSON: (specifier: string, base: string): string | undefined => {
      state.bases.push(base)
      state.attempted.push(specifier)
      return installations[specifier]
    },
  })

interface NodeFs {
  readFileSync(path: string, encoding: 'utf8'): string
}

const nodeFs: NodeFs = process.getBuiltinModule('node:fs')

const fileSystemLayer = FileSystem.layerNoop({
  readFileString: (path: string) => Effect.sync(() => nodeFs.readFileSync(path, 'utf8')),
})

const warningLogger = (state: ResolverState): Logger.Logger<unknown, void> =>
  Logger.make((options) => {
    state.warnings.push(Array.ensure(options.message).map(String).join(' '))
  })

const loadOutcome = (
  specifiers: readonly string[],
  installations: Installations,
): Effect.Effect<LoadOutcome> => {
  const state = freshState()
  return loadPlugins(specifiers, PROJECT).pipe(
    Effect.provide(
      Layer.mergeAll(
        moduleLayer(state, installations),
        Path.layer,
        fileSystemLayer,
        Logger.layer([warningLogger(state)]),
      ),
    ),
    Effect.result,
    Effect.map((result) => ({ result, state })),
  )
}

const loadedOrThrow = (outcome: LoadOutcome): LoadedPlugins => {
  if (Result.isFailure(outcome.result)) {
    throw new Error(`the plugins were expected to load, but the loader refused: ${String(outcome.result.failure)}`)
  }
  return outcome.result.success
}

const failureOrThrow = (outcome: LoadOutcome): Record<string, unknown> => {
  if (Result.isSuccess(outcome.result)) {
    throw new Error('the plugin load was expected to fail')
  }
  const failure = outcome.result.failure
  if (typeof failure !== 'object' || failure === null) {
    throw new Error(`the loader failed with a non-object: ${String(failure)}`)
  }
  return { ...failure }
}

const availableRunners = (loaded: LoadedPlugins): readonly string[] =>
  Option.match(Effect.runSync(Effect.option(create(loaded.pluginsByKind, 'TestRunner', 'vitest'))), {
    onNone: (): readonly string[] => [],
    onSome: (contribution): readonly string[] => [contribution.name],
  })

const attemptedSet = (outcome: LoadOutcome): readonly string[] => [...new Set(outcome.state.attempted)]

const baseSet = (outcome: LoadOutcome): readonly string[] => [...new Set(outcome.state.bases)]

const notFoundLines = (outcome: LoadOutcome): readonly string[] =>
  outcome.state.warnings.filter((line) => line.includes('Cannot find plugin'))

Feature('Loading the plugins a project declares').body(({ scenario }) => {
  scenario(
    'A project declaring one plugin loads exactly that plugin',
    Gherkin.Do.pipe(
      Given('a project whose config declares the runner it has installed')(
        'outcome',
        () => loadOutcome([RUNNER], { [RUNNER]: RUNNER_MANIFEST }),
      ),
      When('the declared package is resolved')(
        'seen',
        (s) =>
          Effect.sync(() => ({
            runners: availableRunners(loadedOrThrow(s.outcome)),
            found: loadedOrThrow(s.outcome).pluginModulePaths,
            bases: baseSet(s.outcome),
          })),
      ),
      Then('exactly that plugin loads, resolved through the project manifest')((s) =>
        Effect.sync(() => {
          expect(s.seen).toStrictEqual({
            runners: ['vitest'],
            found: [RUNNER_ENTRYPOINT],
            bases: [PROJECT_MANIFEST],
          })
        })
      ),
    ),
  )

  scenario(
    'A declared plugin the project does not have is reported on its own',
    Gherkin.Do.pipe(
      Given('a project declaring the runner it has installed and a package it does not have')(
        'outcome',
        () => loadOutcome([RUNNER, UNSHIPPED], { [RUNNER]: RUNNER_MANIFEST }),
      ),
      When('the declared packages are resolved')(
        'seen',
        (s) =>
          Effect.sync(() => ({
            runners: availableRunners(loadedOrThrow(s.outcome)),
            notFound: notFoundLines(s.outcome),
            attempted: attemptedSet(s.outcome),
          })),
      ),
      Then('the runner loads, one line names the missing package, and nothing undeclared is tried')((s) =>
        Effect.sync(() => {
          expect(s.seen.runners).toStrictEqual(['vitest'])
          expect(s.seen.notFound).toHaveLength(1)
          expect(s.seen.notFound[0]).toContain(UNSHIPPED)
          expect(s.seen.notFound[0]).toContain('MODULE_NOT_FOUND')
          expect(s.seen.notFound[0]).not.toContain(PROJECT)
          expect(s.seen.attempted).toStrictEqual([RUNNER, UNSHIPPED])
        })
      ),
    ),
  )

  scenario(
    'The plugin resolves from the project base, not from the copy beside the engine',
    Gherkin.Do.pipe(
      Given('a package installed in the project')(
        'outcome',
        () => loadOutcome([RUNNER], { [RUNNER]: RUNNER_MANIFEST }),
      ),
      When('the declared package is resolved')(
        'seen',
        (s) =>
          Effect.sync(() => ({
            found: loadedOrThrow(s.outcome).pluginModulePaths,
            bases: baseSet(s.outcome),
          })),
      ),
      Then('the project base is the only base consulted')((s) =>
        Effect.sync(() => {
          expect(s.seen).toStrictEqual({ found: [RUNNER_ENTRYPOINT], bases: [PROJECT_MANIFEST] })
        })
      ),
    ),
  )

  scenario(
    'A project declaring no plugins stops with an actionable message',
    Gherkin.Do.pipe(
      Given('a project whose install tree holds plugins but whose config declares none')(
        'outcome',
        () =>
          loadOutcome(
            [],
            {
              '@systemfsoftware/stryker-js-vitest-runner': RUNNER_MANIFEST,
              '@systemfsoftware/stryker-js-language': RUNNER_MANIFEST,
            },
          ),
      ),
      When('the project plugins are loaded')(
        'seen',
        (s) =>
          Effect.sync(() => ({
            failure: failureOrThrow(s.outcome),
            attempted: attemptedSet(s.outcome),
            warnings: s.outcome.state.warnings,
          })),
      ),
      Then('the run stops at prepare at the configured runner and checkers, having discovered nothing')((s) =>
        Effect.sync(() => {
          expect(s.seen.failure['_tag']).toBe('PluginSelectionError')
          expect(s.seen.failure['stage']).toBe('prepare')
          expect(String(s.seen.failure['reason'])).toContain('testRunner')
          expect(String(s.seen.failure['reason'])).toContain('checkers')
          expect(s.seen.attempted).toStrictEqual([])
          expect(s.seen.warnings).toStrictEqual([])
        })
      ),
    ),
  )

  scenario(
    'A plugin declared by path is refused before anything is resolved',
    Gherkin.Do.pipe(
      Given('a project whose config declares its plugin by path')(
        'outcome',
        () => loadOutcome([LOCAL_PLUGIN], {}),
      ),
      When('the project plugins are loaded')(
        'seen',
        (s) =>
          Effect.sync(() => ({
            failure: failureOrThrow(s.outcome),
            attempted: attemptedSet(s.outcome),
            warnings: s.outcome.state.warnings,
          })),
      ),
      Then('the run stops at prepare, naming the rule and the declared path without looking it up')((s) =>
        Effect.sync(() => {
          expect(s.seen.failure['_tag']).toBe('PluginSelectionError')
          expect(s.seen.failure['stage']).toBe('prepare')
          expect(String(s.seen.failure['reason'])).toContain('Path-prefixed plugin specifiers are not supported')
          expect(String(s.seen.failure['reason'])).toContain(LOCAL_PLUGIN)
          expect(s.seen.attempted).toStrictEqual([])
          expect(s.seen.warnings).toStrictEqual([])
        })
      ),
    ),
  )

  scenario(
    'Two declared plugins contributing the same runner resolve to the one declared last',
    Gherkin.Do.pipe(
      Given('a project declaring two packages that both contribute a vitest runner')(
        'outcome',
        () => loadOutcome([RUNNER, RUNNER_LATE], { [RUNNER]: RUNNER_MANIFEST, [RUNNER_LATE]: RUNNER_LATE_MANIFEST }),
      ),
      When('the shadowing is resolved')(
        'seen',
        (s) =>
          Effect.sync(() => ({
            sources: loadedOrThrow(s.outcome).pluginSources,
            warnings: s.outcome.state.warnings,
          })),
      ),
      Then('the runner resolves from the last declaring module and the shadowing is reported')((s) =>
        Effect.sync(() => {
          expect(s.seen.sources).toStrictEqual([
            {
              kind: 'TestRunner',
              name: 'vitest',
              modulePath: RUNNER_LATE_ENTRYPOINT,
              workerEntry: VITEST_WORKER_ENTRY,
            },
          ])
          expect(s.seen.warnings.some((line) => line.includes('shadows plugin at index 0'))).toBe(true)
        })
      ),
    ),
  )

  scenario(
    'A package contributing the same runner twice keeps a single winner',
    Gherkin.Do.pipe(
      Given('a project declaring one package whose plugin list repeats the same runner')(
        'outcome',
        () => loadOutcome([DUPLICATE_RUNNER], { [DUPLICATE_RUNNER]: DUPLICATE_RUNNER_MANIFEST }),
      ),
      When('the duplicated runner is resolved')(
        'seen',
        (s) => Effect.sync(() => ({ sources: loadedOrThrow(s.outcome).pluginSources })),
      ),
      Then('exactly one contribution survives, resolved from that module')((s) =>
        Effect.sync(() => {
          expect(s.seen.sources).toStrictEqual([
            {
              kind: 'TestRunner',
              name: 'vitest',
              modulePath: DUPLICATE_RUNNER_ENTRYPOINT,
              workerEntry: VITEST_WORKER_ENTRY,
            },
          ])
        })
      ),
    ),
  )
})
