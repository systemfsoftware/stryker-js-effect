import { Gherkin, Given, it, layer, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import { importModule } from '@systemfsoftware/stryker-js-engine'
import { loadPlugins } from '@systemfsoftware/stryker-js-engine/plugin-loader'
import type { LoadedPlugins } from '@systemfsoftware/stryker-js-engine/plugin-loader'
import * as Array from 'effect/Array'
import * as Effect from 'effect/Effect'
import * as Logger from 'effect/Logger'
import * as Result from 'effect/Result'
import { expect } from 'vitest'

const Feature = makeFeature({ it, layer })

const UNSHIPPED = '@acme/stryker-unshipped'
const DECLARES_EMPTY_PLUGIN_LIST = '@systemfsoftware/stryker-js-instrumenter'
const RESOLVES_WITHOUT_PLUGINS = 'effect'
const LOCAL_PLUGIN = './local-plugin.js'

const EFFECT_SCHEMA_DECLARATIONS_IGNORER = '@systemfsoftware/stryker-ignorer-effect-schema-declarations'
const IN_SOURCE_VITEST_BLOCK_IGNORER = '@systemfsoftware/stryker-ignorer-in-source-vitest-block'
const EFFECT_SCHEMA_DECLARATIONS_IGNORER_NAME = 'effect-schema-declarations'
const IN_SOURCE_VITEST_BLOCK_IGNORER_NAME = 'in-source-vitest-block'

const PLUGIN_RUNNER_FIXTURE_URL = new URL('./__fixtures__/plugin-runner/index.mjs', import.meta.url).href

const RUNNER_PLUGIN = {
  kind: 'TestRunner',
  name: 'vitest',
  workerEntry: 'file:///project/node_modules/@acme/stryker-runner/dist/main.mjs',
}

interface LoadOutcome {
  readonly result: Result.Result<LoadedPlugins, unknown>
  readonly warnings: readonly string[]
}

const capturingWarnings = (warnings: string[]): Logger.Logger<unknown, void> =>
  Logger.make((options) => {
    warnings.push(Array.ensure(options.message).map(String).join(' '))
  })

const loadOutcome = (specifiers: readonly string[]): Effect.Effect<LoadOutcome> => {
  const warnings: string[] = []
  return loadPlugins(specifiers).pipe(
    Effect.provide(Logger.layer([capturingWarnings(warnings)])),
    Effect.result,
    Effect.map((result) => ({ result, warnings })),
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

const reasonOf = (failure: Record<string, unknown>): string => String(failure['reason'])

const lineContaining = (outcome: LoadOutcome, fragment: string): string | undefined =>
  outcome.warnings.find((line) => line.includes(fragment))

const ignorerNamesOf = (loaded: LoadedPlugins): readonly string[] => loaded.ignorers.map((ignorer) => ignorer.name)

const shouldIgnoreKindsOf = (loaded: LoadedPlugins): readonly string[] =>
  loaded.ignorers.map((ignorer) => typeof ignorer.shouldIgnore)

const strykerPluginsOf = (module: unknown): unknown => {
  if (typeof module === 'object' && module !== null && 'strykerPlugins' in module) {
    return module.strykerPlugins
  }
  return undefined
}

Feature('Loading the plugins a project declares').body(({ scenario }) => {
  scenario(
    'A project whose config declares no plugins stops with an actionable message',
    Gherkin.Do.pipe(
      Given('a project whose config declares no plugins')(
        'outcome',
        () => loadOutcome([]),
      ),
      When('the project plugins are loaded')(
        'seen',
        (s) =>
          Effect.sync(() => ({
            failure: failureOrThrow(s.outcome),
            warnings: s.outcome.warnings,
          })),
      ),
      Then('the run stops at prepare at the configured runner and checkers, having discovered nothing')((s) =>
        Effect.sync(() => {
          expect(s.seen.failure['_tag']).toBe('PluginSelectionError')
          expect(s.seen.failure['stage']).toBe('prepare')
          expect(reasonOf(s.seen.failure)).toContain('testRunner')
          expect(reasonOf(s.seen.failure)).toContain('checkers')
          expect(s.seen.warnings).toStrictEqual([])
        })
      ),
    ),
  )

  scenario(
    'A package the project cannot resolve stops the run at prepare, naming it',
    Gherkin.Do.pipe(
      Given('a project declaring a package it does not have')(
        'outcome',
        () => loadOutcome([UNSHIPPED]),
      ),
      When('the declared package is resolved')(
        'seen',
        (s) => Effect.sync(() => ({ failure: failureOrThrow(s.outcome) })),
      ),
      Then('the run stops at prepare, naming the package that did not resolve')((s) =>
        Effect.sync(() => {
          expect(s.seen.failure['_tag']).toBe('PluginSelectionError')
          expect(s.seen.failure['stage']).toBe('prepare')
          expect(reasonOf(s.seen.failure)).toContain(UNSHIPPED)
        })
      ),
    ),
  )

  scenario(
    'A package that resolves and declares a plugin list loads, resolved by URL',
    Gherkin.Do.pipe(
      Given('a project declaring a package that declares its plugin list')(
        'outcome',
        () => loadOutcome([DECLARES_EMPTY_PLUGIN_LIST]),
      ),
      When('the declared package is resolved')(
        'seen',
        (s) =>
          Effect.sync(() => ({
            modulePaths: loadedOrThrow(s.outcome).pluginModulePaths,
            sources: loadedOrThrow(s.outcome).pluginSources,
            warnings: s.outcome.warnings,
          })),
      ),
      Then('the module is loaded by the URL the resolver returned, with no warning')((s) =>
        Effect.sync(() => {
          expect(s.seen.modulePaths).toHaveLength(1)
          expect(s.seen.modulePaths[0]).toContain('stryker-js-instrumenter')
          expect(s.seen.sources).toStrictEqual([])
          expect(s.seen.warnings).toStrictEqual([])
        })
      ),
    ),
  )

  scenario(
    'A resolvable package that contributes no plugin is reported, not silently ignored',
    Gherkin.Do.pipe(
      Given('a project declaring a package that exports no StrykerJS plugin')(
        'outcome',
        () => loadOutcome([RESOLVES_WITHOUT_PLUGINS]),
      ),
      When('the declared package is resolved and loaded')(
        'seen',
        (s) =>
          Effect.sync(() => ({
            modulePaths: loadedOrThrow(s.outcome).pluginModulePaths,
            contributed: loadedOrThrow(s.outcome).pluginSources,
            reported: lineContaining(s.outcome, 'did not contribute a StrykerJS plugin'),
          })),
      ),
      Then('the package is reported as contributing nothing and is not handed to a worker')((s) =>
        Effect.sync(() => {
          expect(s.seen.reported).toBeDefined()
          expect(s.seen.reported).toContain(RESOLVES_WITHOUT_PLUGINS)
          expect(s.seen.contributed).toStrictEqual([])
          expect(s.seen.modulePaths).toStrictEqual([])
        })
      ),
    ),
  )

  scenario(
    'An unresolvable package beside a resolvable one warns with the resolver reason',
    Gherkin.Do.pipe(
      Given('a project declaring a package it does not have and one that resolves')(
        'outcome',
        () => loadOutcome([UNSHIPPED, RESOLVES_WITHOUT_PLUGINS]),
      ),
      When('the declared packages are resolved')(
        'seen',
        (s) =>
          Effect.sync(() => ({
            modulePaths: loadedOrThrow(s.outcome).pluginModulePaths,
            missed: lineContaining(s.outcome, `Cannot find plugin "${UNSHIPPED}"`),
            reported: lineContaining(s.outcome, 'did not contribute a StrykerJS plugin'),
          })),
      ),
      Then('the resolvable package still loads and the miss names its resolution failure')((s) =>
        Effect.sync(() => {
          expect(s.seen.missed).toBeDefined()
          expect(s.seen.missed).toContain('ERR_MODULE_NOT_FOUND')
          expect(s.seen.reported).toBeDefined()
          expect(s.seen.modulePaths).toStrictEqual([])
        })
      ),
    ),
  )

  scenario(
    'A plugin declared by path is refused before anything is resolved',
    Gherkin.Do.pipe(
      Given('a project whose config declares its plugin by path')(
        'outcome',
        () => loadOutcome([LOCAL_PLUGIN]),
      ),
      When('the project plugins are loaded')(
        'seen',
        (s) =>
          Effect.sync(() => ({
            failure: failureOrThrow(s.outcome),
            warnings: s.outcome.warnings,
          })),
      ),
      Then('the run stops at prepare, naming the rule and the declared path without looking it up')((s) =>
        Effect.sync(() => {
          expect(s.seen.failure['_tag']).toBe('PluginSelectionError')
          expect(s.seen.failure['stage']).toBe('prepare')
          expect(reasonOf(s.seen.failure)).toContain('Path-prefixed plugin specifiers are not supported')
          expect(reasonOf(s.seen.failure)).toContain(LOCAL_PLUGIN)
          expect(s.seen.warnings).toStrictEqual([])
        })
      ),
    ),
  )

  scenario(
    'A plugin module loaded by its URL contributes the plugins it exports',
    Gherkin.Do.pipe(
      Given('a plugin module published at a file URL')(
        'module',
        () => importModule(PLUGIN_RUNNER_FIXTURE_URL),
      ),
      When('the module is imported by that URL')(
        'seen',
        (s) => Effect.sync(() => ({ plugins: strykerPluginsOf(s.module) })),
      ),
      Then('the plugins the module exports are available to the loader')((s) =>
        Effect.sync(() => {
          expect(s.seen.plugins).toStrictEqual([RUNNER_PLUGIN])
        })
      ),
    ),
  )

  scenario(
    'An ignorer package the project declares loads and its ignorer joins the run',
    Gherkin.Do.pipe(
      Given('a project declaring an ignorer package')(
        'outcome',
        () => loadOutcome([EFFECT_SCHEMA_DECLARATIONS_IGNORER]),
      ),
      When('the declared package is resolved and loaded')(
        'seen',
        (s) =>
          Effect.sync(() => ({
            names: ignorerNamesOf(loadedOrThrow(s.outcome)),
            callables: shouldIgnoreKindsOf(loadedOrThrow(s.outcome)),
            modulePaths: loadedOrThrow(s.outcome).pluginModulePaths,
            sources: loadedOrThrow(s.outcome).pluginSources,
            warnings: s.outcome.warnings,
          })),
      ),
      Then('its ignorer joins the run and the package contributes no plugin')((s) =>
        Effect.sync(() => {
          expect(s.seen.names).toStrictEqual([EFFECT_SCHEMA_DECLARATIONS_IGNORER_NAME])
          expect(s.seen.callables).toStrictEqual(['function'])
          expect(s.seen.modulePaths).toStrictEqual([])
          expect(s.seen.sources).toStrictEqual([])
          expect(s.seen.warnings).toStrictEqual([])
        })
      ),
    ),
  )

  scenario(
    'Two ignorer packages load side by side, neither replacing the other',
    Gherkin.Do.pipe(
      Given('a project declaring both ignorer packages')(
        'outcome',
        () => loadOutcome([EFFECT_SCHEMA_DECLARATIONS_IGNORER, IN_SOURCE_VITEST_BLOCK_IGNORER]),
      ),
      When('the declared packages are resolved and loaded')(
        'seen',
        (s) =>
          Effect.sync(() => ({
            names: ignorerNamesOf(loadedOrThrow(s.outcome)),
            replacementLines: s.outcome.warnings.filter((line) => line.includes('shadows')),
            warnings: s.outcome.warnings,
          })),
      ),
      Then('both ignorers join the run and no replacement is reported')((s) =>
        Effect.sync(() => {
          expect(s.seen.names).toStrictEqual([
            EFFECT_SCHEMA_DECLARATIONS_IGNORER_NAME,
            IN_SOURCE_VITEST_BLOCK_IGNORER_NAME,
          ])
          expect(s.seen.replacementLines).toStrictEqual([])
          expect(s.seen.warnings).toStrictEqual([])
        })
      ),
    ),
  )

  scenario(
    'An ignorer package declared twice is loaded once and its ignorer joins the run once',
    Gherkin.Do.pipe(
      Given('a project declaring the same ignorer package twice')(
        'outcome',
        () => loadOutcome([EFFECT_SCHEMA_DECLARATIONS_IGNORER, EFFECT_SCHEMA_DECLARATIONS_IGNORER]),
      ),
      When('the declared packages are resolved and loaded')(
        'seen',
        (s) =>
          Effect.sync(() => ({
            names: ignorerNamesOf(loadedOrThrow(s.outcome)),
            warnings: s.outcome.warnings,
          })),
      ),
      Then('a single ignorer is contributed and nothing is reported')((s) =>
        Effect.sync(() => {
          expect(s.seen.names).toStrictEqual([EFFECT_SCHEMA_DECLARATIONS_IGNORER_NAME])
          expect(s.seen.warnings).toStrictEqual([])
        })
      ),
    ),
  )
})
