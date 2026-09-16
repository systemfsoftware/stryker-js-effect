import { Gherkin, Given, it, layer, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import { create, loadPlugins } from '@systemfsoftware/stryker-js-engine/plugin-loader'
import type { LoadedPlugins } from '@systemfsoftware/stryker-js-engine/plugin-loader'
import { Module } from '@systemfsoftware/stryker-js-language'
import type { ModuleRequire } from '@systemfsoftware/stryker-js-language'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as Layer from 'effect/Layer'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Path from 'effect/Path'
import { expect } from 'vitest'

const Feature = makeFeature({ it, layer })

const PROJECT = '/project'

const INSTALLED_DIRECTORY = `${PROJECT}/node_modules/@systemfsoftware`

const DEFAULT_PATTERN = '@systemfsoftware/stryker-js-*'

const RUNNER = '@systemfsoftware/stryker-js-vitest-runner'

const UNSHIPPED = '@systemfsoftware/stryker-js-unshipped'

const vitestContribution = {
  _tag: 'PluginContribution',
  kind: 'TestRunner',
  name: 'vitest',
  layer: { _tag: 'Layer' },
}

const runnerModule = { strykerPlugins: [vitestContribution] }

const missingPackage = (descriptor: string): Error =>
  Object.assign(new Error(`Cannot find module '${descriptor}'`), { code: 'MODULE_NOT_FOUND' })

const isLoadedPlugins = (value: unknown): value is LoadedPlugins =>
  typeof value === 'object' && value !== null && 'pluginsByKind' in value && 'pluginModulePaths' in value

const loadedIn = (scope: Record<string, unknown>): LoadedPlugins => {
  const value = scope['loaded']
  if (!isLoadedPlugins(value)) {
    throw new Error('the loaded plugins are missing from the scenario')
  }
  return value
}

const installedOnly = (entries: readonly string[]) =>
  FileSystem.layerNoop({
    readDirectory: (directory: string) =>
      Effect.succeed(
        Match.value(directory).pipe(
          Match.when(INSTALLED_DIRECTORY, () => [...entries]),
          Match.orElse((): string[] => []),
        ),
      ),
  })

const moduleLoader = (
  load: (descriptor: string) => unknown,
) =>
  Layer.succeed(Module, {
    createRequire: (): ModuleRequire =>
      Object.assign((descriptor: string): unknown => load(descriptor), {
        resolve: (descriptor: string): string => descriptor,
      }),
    isBuiltin: (moduleName) => moduleName.startsWith('node:'),
  })

const loadProject = (entries: readonly string[], load: (descriptor: string) => unknown) =>
  loadPlugins([DEFAULT_PATTERN], PROJECT).pipe(
    Effect.provide(Layer.mergeAll(installedOnly(entries), Path.layer, moduleLoader(load))),
  )

const availableTestRunners = (loaded: LoadedPlugins): readonly string[] =>
  Option.match(Effect.runSync(Effect.option(create(loaded.pluginsByKind, 'TestRunner', 'vitest'))), {
    onNone: (): readonly string[] => [],
    onSome: (contribution): readonly string[] => [contribution.name],
  })

const outcomeOf = (scope: Record<string, unknown>) => {
  const loaded = loadedIn(scope)
  return { runners: availableTestRunners(loaded), found: loaded.pluginModulePaths }
}

const loadEverything = (descriptor: string): unknown => {
  if (descriptor === UNSHIPPED) {
    throw missingPackage(descriptor)
  }
  return runnerModule
}

Feature('Finding the plugins a project has installed')
  .body(({ scenario }) => {
    scenario(
      'A plugin installed in the project is found by the default pattern',
      Gherkin.Do.pipe(
        Given('a project with the vitest runner installed beside it')(
          'loaded',
          () => loadProject(['stryker-js-vitest-runner'], () => runnerModule),
        ),
        When('the default plugin pattern is applied to that project')(
          'outcome',
          (s) => Effect.sync(() => outcomeOf(s)),
        ),
        Then('the vitest runner is available to the run')((s) =>
          Effect.sync(() => {
            expect(s['outcome']).toStrictEqual({ runners: ['vitest'], found: [RUNNER] })
          })
        ),
      ),
    )

    scenario(
      'A listed package the project does not have is left out',
      Gherkin.Do.pipe(
        Given('a project listing an unshipped package beside the installed runner')(
          'loaded',
          () => loadProject(['stryker-js-vitest-runner', 'stryker-js-unshipped'], loadEverything),
        ),
        When('the default plugin pattern is applied to that project')(
          'outcome',
          (s) => Effect.sync(() => outcomeOf(s)),
        ),
        Then('the runner is available and the unshipped package is left out')((s) =>
          Effect.sync(() => {
            expect(s['outcome']).toStrictEqual({ runners: ['vitest'], found: [RUNNER] })
          })
        ),
      ),
    )
  })
