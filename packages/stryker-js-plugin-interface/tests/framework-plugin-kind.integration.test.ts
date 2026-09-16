import { expectTypeOf } from 'vitest'

import { Gherkin, Given, it, layer, makeFeature, Then } from '@systemfsoftware/effect-gherkin-spec'
import { Framework, type FrameworkService } from '@systemfsoftware/stryker-js-language'
import {
  composePlugins,
  declarePlugin,
  type PluginLayerContribution,
} from '@systemfsoftware/stryker-js-plugin-interface'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import * as Option from 'effect/Option'

const Feature = makeFeature({ it, layer })

const frameworkService: FrameworkService = {
  claim: {
    formatId: 'html',
    extensions: ['.html', '.htm', '.vue'],
    language: 'html',
    ownerVersion: '1',
    contractVersion: '1',
  },
  parse: (rawContent, _context) => Effect.succeed({ formatId: 'html', rawContent, regions: [] }),
  transform: (document) => Effect.succeed(document),
  print: (document) => Effect.succeed(document.rawContent),
  disableTypeChecks: (content) => Effect.succeed(content),
}

Feature('Declaring a framework format plugin').body(({ scenario }) => {
  scenario(
    'A declared framework plugin composes into the registry alongside the other kinds',
    Gherkin.Do.pipe(
      Given('a framework plugin declared with its service layer')(
        'contribution',
        () =>
          Effect.succeed(declarePlugin('Framework', 'framework-fixture', Layer.succeed(Framework, frameworkService))),
      ),
      Then('the composition carries the declared layer')(
        (s: { contribution: PluginLayerContribution<'Framework'> }) => {
          expectTypeOf(s.contribution).toEqualTypeOf<PluginLayerContribution<'Framework'>>()
          return Effect.succeed(
            Option.match(composePlugins([s.contribution]).layer, { onNone: () => false, onSome: () => true }),
          )
        },
      ),
    ),
  )
})
