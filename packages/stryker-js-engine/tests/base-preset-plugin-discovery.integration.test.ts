import { Gherkin, Given, it, layer, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import basePreset from '@systemfsoftware/stryker-js-engine/config/base'
import type { LoadedPlugins } from '@systemfsoftware/stryker-js-engine/plugin-loader'
import { loadPlugins } from '@systemfsoftware/stryker-js-engine/plugin-loader'
import * as Effect from 'effect/Effect'
import { expect } from 'vitest'

import {
  installWorkspaceFrameworkPlugins,
  pluginInstallEnvironmentLayer,
  removePluginInstall,
} from './__fixtures__/loader-support.js'

const SHIPPED_PRESET_PLUGINS: readonly string[] = basePreset.plugins ?? []

const ANGULAR_PLUGIN = '@systemfsoftware/stryker-js-angular'
const SVELTE_PLUGIN = '@systemfsoftware/stryker-js-svelte'
const CLI_PACKAGE = '@systemfsoftware/stryker-js-cli'

interface DiscoveredPlugin {
  readonly outcome: string | undefined
  readonly frameworkContributions: readonly string[]
  readonly registeredFormats: readonly string[]
}

const discoveredPluginOf = (loaded: LoadedPlugins, moduleName: string): DiscoveredPlugin => {
  const outcome = loaded.outcomes.find((candidate) => candidate.moduleName === moduleName)
  return {
    outcome: outcome?.outcome,
    frameworkContributions: (outcome?.contributions ?? [])
      .filter((contribution) => contribution.kind === 'Framework')
      .map((contribution) => contribution.name),
    registeredFormats: loaded.frameworks
      .filter((entry) => entry.moduleName === moduleName)
      .map((entry) => entry.claim.formatId),
  }
}

const Feature = makeFeature({ it, layer })

Feature('Framework plugin discovery from the shipped preset').body(({ scenario }) => {
  scenario(
    'A project that installed a framework plugin discovers it from the preset it extends',
    Gherkin.Do.pipe(
      Given('a project whose install holds the Angular and Svelte framework plugin packages')(
        'install',
        () =>
          Effect.acquireRelease(
            installWorkspaceFrameworkPlugins,
            (install) => Effect.sync(() => removePluginInstall(install)),
          ),
      ),
      When('the engine loads the plugin list the shipped preset declares')(
        'loaded',
        (s) =>
          loadPlugins(SHIPPED_PRESET_PLUGINS, s.install.directory).pipe(
            Effect.provide(pluginInstallEnvironmentLayer(s.install)),
          ),
      ),
      Then('both plugin packages load and the installed CLI is tolerated rather than refusing the run')((s) =>
        Effect.sync(() => {
          expect(discoveredPluginOf(s.loaded, ANGULAR_PLUGIN)).toStrictEqual({
            outcome: 'loaded',
            frameworkContributions: ['angular'],
            registeredFormats: ['html'],
          })
          expect(discoveredPluginOf(s.loaded, SVELTE_PLUGIN)).toStrictEqual({
            outcome: 'loaded',
            frameworkContributions: ['svelte'],
            registeredFormats: ['svelte'],
          })
          expect(discoveredPluginOf(s.loaded, CLI_PACKAGE).outcome).toBe('undescribed')
          expect(s.loaded.outcomes.filter((outcome) => outcome.outcome === 'failed')).toStrictEqual([])
        })
      ),
    ),
  )
})
