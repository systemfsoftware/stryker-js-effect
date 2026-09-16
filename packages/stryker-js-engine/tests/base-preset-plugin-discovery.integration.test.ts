import { Gherkin, Given, it, layer, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import basePreset from '@systemfsoftware/stryker-js-engine/config/base'
import * as Effect from 'effect/Effect'
import { expect } from 'vitest'

const Feature = makeFeature({ it, layer })

Feature('Discovering framework plugins through the shipped preset').body(({ scenario }) => {
  scenario(
    'A project extending the preset discovers framework plugins through the default glob',
    Gherkin.Do.pipe(
      Given('the engine preset a project extends')('preset', () => Effect.sync(() => basePreset)),
      When('that preset is read')(
        'plugins',
        (s: { preset: { readonly plugins?: readonly string[] } }) => Effect.succeed(s.preset.plugins),
      ),
      Then('it names the default plugin glob beside the family names the glob does not match')((s: {
        plugins: readonly string[] | undefined
      }) => {
        expect(s.plugins).toStrictEqual([
          '@systemfsoftware/stryker-js-*',
          'stryker-ignorer-effect-schema-declarations',
          'stryker-test-contribution',
        ])
      }),
    ),
  )
})
