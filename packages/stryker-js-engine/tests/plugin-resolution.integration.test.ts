import { Gherkin, Given, it, layer, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import { create, loadPlugins } from '@systemfsoftware/stryker-js-engine/plugin-loader'
import type { LoadedPlugins } from '@systemfsoftware/stryker-js-engine/plugin-loader'
import { Module } from '@systemfsoftware/stryker-js-language'
import type { ModuleRequire } from '@systemfsoftware/stryker-js-language'
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
const HOST_MANIFEST = '/host/dist/package.json'

const RUNNER = '@acme/stryker-runner'
const UNSHIPPED = '@acme/stryker-unshipped'
const RUNNER_ENTRYPOINT = `${PROJECT}/node_modules/@acme/stryker-runner/dist/index.mjs`
const HOST_RUNNER_ENTRYPOINT = '/host/dist/node_modules/@acme/stryker-runner/dist/index.mjs'
const LANGUAGE_ENTRYPOINT = `${PROJECT}/node_modules/@systemfsoftware/stryker-js-language/dist/index.mjs`

const vitestDescriptor = {
  kind: 'TestRunner',
  name: 'vitest',
}

const runnerModule = { strykerPlugins: [vitestDescriptor] }

type InstallTree = Record<string, string>
type InstallTrees = Record<string, InstallTree>

const tree = (entries: Record<string, string>): InstallTree => entries

const missingModule = (specifier: string, parent: string): Error =>
  Object.assign(new Error(`Cannot find module '${specifier}' from '${parent}'`), { code: 'MODULE_NOT_FOUND' })

const resolveFrom = (trees: InstallTrees, parent: string, specifier: string): string => {
  if (!Object.hasOwn(trees, parent)) {
    throw missingModule(specifier, parent)
  }
  const installTree = trees[parent]
  if (installTree === undefined || !Object.hasOwn(installTree, specifier)) {
    throw missingModule(specifier, parent)
  }
  const entrypoint = installTree[specifier]
  if (entrypoint === undefined) {
    throw missingModule(specifier, parent)
  }
  return entrypoint
}

interface ResolverState {
  readonly parents: string[]
  readonly attempted: string[]
  readonly warnings: string[]
}

interface LoadOutcome {
  readonly result: Result.Result<LoadedPlugins, unknown>
  readonly state: ResolverState
}

const freshState = (): ResolverState => ({ parents: [], attempted: [], warnings: [] })

const moduleLayer = (
  state: ResolverState,
  trees: InstallTrees,
  load: (specifier: string) => unknown,
): Layer.Layer<Module> =>
  Layer.succeed(Module, {
    createRequire: (filename: string | URL): ModuleRequire => {
      const parent = String(filename)
      state.parents.push(parent)
      return Object.assign(
        (specifier: string): unknown => {
          state.attempted.push(specifier)
          return load(specifier)
        },
        {
          resolve: (specifier: string): string => {
            state.attempted.push(specifier)
            return resolveFrom(trees, parent, specifier)
          },
        },
      )
    },
    isBuiltin: (moduleName: string) => moduleName.startsWith('node:'),
  })

const warningLogger = (state: ResolverState): Logger.Logger<unknown, void> =>
  Logger.make((options) => {
    state.warnings.push(Array.ensure(options.message).map(String).join(' '))
  })

const untouchedFileSystem = FileSystem.layerNoop({
  readDirectory: () => Effect.die(new Error('the loader must not walk the filesystem to discover plugins')),
})

const loadOutcome = (
  specifiers: readonly string[],
  trees: InstallTrees,
  load: (specifier: string) => unknown,
): Effect.Effect<LoadOutcome> => {
  const state = freshState()
  return loadPlugins(specifiers, PROJECT).pipe(
    Effect.provide(
      Layer.mergeAll(
        moduleLayer(state, trees, load),
        Path.layer,
        untouchedFileSystem,
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

const parentSet = (outcome: LoadOutcome): readonly string[] => [...new Set(outcome.state.parents)]

const notFoundLines = (outcome: LoadOutcome): readonly string[] =>
  outcome.state.warnings.filter((line) => line.includes('Cannot find plugin'))

Feature('Loading the plugins a project declares').body(({ scenario }) => {
  scenario(
    'A project declaring one plugin loads exactly that plugin',
    Gherkin.Do.pipe(
      Given('a project whose config declares the runner it has installed')(
        'outcome',
        () => loadOutcome([RUNNER], { [PROJECT_MANIFEST]: tree({ [RUNNER]: RUNNER_ENTRYPOINT }) }, () => runnerModule),
      ),
      When('the declared package is resolved')(
        'seen',
        (s) =>
          Effect.sync(() => ({
            runners: availableRunners(loadedOrThrow(s.outcome)),
            found: loadedOrThrow(s.outcome).pluginModulePaths,
            parents: parentSet(s.outcome),
          })),
      ),
      Then('exactly that plugin loads, resolved through the project manifest')((s) =>
        Effect.sync(() => {
          expect(s.seen).toStrictEqual({
            runners: ['vitest'],
            found: [RUNNER_ENTRYPOINT],
            parents: [PROJECT_MANIFEST],
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
        () =>
          loadOutcome(
            [RUNNER, UNSHIPPED],
            { [PROJECT_MANIFEST]: tree({ [RUNNER]: RUNNER_ENTRYPOINT }) },
            () => runnerModule,
          ),
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
          expect(s.seen.attempted).toStrictEqual([RUNNER, UNSHIPPED])
        })
      ),
    ),
  )

  scenario(
    'The plugin resolves from the project, not from the copy beside the engine',
    Gherkin.Do.pipe(
      Given('a package installed in the project and beside the engine')(
        'outcome',
        () =>
          loadOutcome(
            [RUNNER],
            {
              [PROJECT_MANIFEST]: tree({ [RUNNER]: RUNNER_ENTRYPOINT }),
              [HOST_MANIFEST]: tree({ [RUNNER]: HOST_RUNNER_ENTRYPOINT }),
            },
            () => runnerModule,
          ),
      ),
      When('the declared package is resolved')(
        'seen',
        (s) =>
          Effect.sync(() => ({
            found: loadedOrThrow(s.outcome).pluginModulePaths,
            parents: parentSet(s.outcome),
          })),
      ),
      Then('the project copy loads and the copy beside the engine is never consulted')((s) =>
        Effect.sync(() => {
          expect(s.seen).toStrictEqual({ found: [RUNNER_ENTRYPOINT], parents: [PROJECT_MANIFEST] })
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
              [PROJECT_MANIFEST]: tree({
                '@systemfsoftware/stryker-js-vitest-runner': RUNNER_ENTRYPOINT,
                '@systemfsoftware/stryker-js-language': LANGUAGE_ENTRYPOINT,
              }),
            },
            () => runnerModule,
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
})
