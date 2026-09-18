import { Gherkin, Given, it, layer, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import { type ConfigEnv, defineConfig, mergeConfig, type StrykerConfig } from '@systemfsoftware/stryker-js/config'
import * as Effect from 'effect/Effect'
import { expect } from 'vitest'

const Feature = makeFeature({ it, layer })

const RUN_ENV: ConfigEnv = { command: 'run', isDryRun: false, mode: 'human', isCi: false }

Feature('Authoring a Stryker configuration with the published helper')
  .body(({ scenario }) => {
    scenario(
      'A configuration the author wrote is the one the run receives',
      Gherkin.Do.pipe(
        Given('a configuration raising the high threshold to 90')(
          'written',
          () => Effect.succeed({ thresholds: { high: 90 } } satisfies StrykerConfig),
        ),
        When('the author hands it to the helper')(
          'received',
          (s) => Effect.succeed(defineConfig(s.written)),
        ),
        Then('the run receives exactly the configuration that was written')((s) => {
          expect(s.received).toBe(s.written)
        }),
      ),
    )

    scenario(
      'A configuration that derives its settings stays uncalled until the run reads it',
      Gherkin.Do.pipe(
        Given('a configuration deriving its thresholds from how the run was invoked')(
          'derived',
          () =>
            Effect.sync(() => {
              const calls: string[] = []
              const highByMode: Record<string, number> = { machine: 91 }
              const factory = (env: ConfigEnv): StrykerConfig => {
                calls.push(env.mode)
                return { thresholds: { high: highByMode[env.mode] ?? 92 } }
              }
              return { calls, factory }
            }),
        ),
        When('the author hands the deriving configuration to the helper')(
          'received',
          (s) => Effect.succeed(defineConfig(s.derived.factory)),
        ),
        Then('the run receives that same configuration, still uncalled')((s) => {
          expect(s.received).toBe(s.derived.factory)
          expect(s.derived.calls).toStrictEqual([])
          expect(s.received(RUN_ENV)).toStrictEqual({ thresholds: { high: 92 } })
        }),
      ),
    )

    scenario(
      'An override composes onto a preset without inheriting its plugins',
      Gherkin.Do.pipe(
        Given('a preset raising the low threshold to 50 and naming one plugin')(
          'preset',
          () => Effect.succeed({ plugins: ['@acme/preset'], thresholds: { low: 50 } } satisfies StrykerConfig),
        ),
        When('an override naming another plugin and a higher threshold is composed onto the preset')(
          'composed',
          (s) => Effect.succeed(mergeConfig(s.preset, { plugins: ['@acme/mine'], thresholds: { high: 70 } })),
        ),
        Then('the thresholds are merged and the plugin list is the override’s own')((s) => {
          expect(s.composed.thresholds).toStrictEqual({ low: 50, high: 70 })
          expect(s.composed.plugins).toStrictEqual(['@acme/mine'])
        }),
      ),
    )
  })
