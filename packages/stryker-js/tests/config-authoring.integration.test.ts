import { Gherkin, Given, it, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import type { Options } from '@systemfsoftware/stryker-js-plugin-interface'
import { type ConfigEnv, defineConfig, mergeConfig } from '@systemfsoftware/stryker-js/config'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'

const Feature = makeFeature({ it })

const RUN_ENV: ConfigEnv = { command: 'run', isDryRun: false, mode: 'human', isCi: false }

Feature('Authoring a Stryker configuration with the published helper')
  .withLayer(Layer.empty)
  .body(({ scenario }) => {
    scenario(
      'A configuration the author wrote is the one the run receives',
      Gherkin.Do.pipe(
        Given('a configuration raising the high threshold to 90')(
          'written',
          () => Effect.succeed({ thresholds: { high: 90 } } satisfies Options.PartialStrykerOptions),
        ),
        When('the author hands it to the helper')(
          'received',
          (s) => Effect.succeed(defineConfig(s.written)),
        ),
        Then('the run receives exactly the configuration that was written')((s, expect) =>
          expect(s.received).toBe(s.written)
        ),
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
              const factory = (env: ConfigEnv): Options.PartialStrykerOptions => {
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
        Then('the run receives that same configuration, still uncalled, and it resolves the run it is given')(
          (s, expect) => {
            const uncalled = [...s.derived.calls]
            const resolved = s.received(RUN_ENV)
            return expect({ received: s.received, calls: uncalled, resolved }).toEqual({
              received: s.derived.factory,
              calls: [],
              resolved: { thresholds: { high: 92 } },
            })
          },
        ),
      ),
    )

    scenario(
      'An override composes onto a preset without inheriting its plugins',
      Gherkin.Do.pipe(
        Given('a preset raising the low threshold to 50 and naming one plugin')(
          'preset',
          () =>
            Effect.succeed(
              { plugins: ['@acme/preset'], thresholds: { low: 50 } } satisfies Options.PartialStrykerOptions,
            ),
        ),
        When('an override naming another plugin and a higher threshold is composed onto the preset')(
          'composed',
          (s) => Effect.succeed(mergeConfig(s.preset, { plugins: ['@acme/mine'], thresholds: { high: 70 } })),
        ),
        Then('the thresholds are merged and the plugin list is the override’s own')((s, expect) =>
          expect({ thresholds: s.composed.thresholds, plugins: s.composed.plugins }).toEqual({
            thresholds: { low: 50, high: 70 },
            plugins: ['@acme/mine'],
          })
        ),
      ),
    )
  })
