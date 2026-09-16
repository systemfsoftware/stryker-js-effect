import { Framework } from '@systemfsoftware/stryker-js-language'
import { declarePlugin } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'

export const strykerPlugins = [
  declarePlugin(
    'Framework',
    'build-dies-fixture',
    Layer.effect(Framework, Effect.die(new Error('the framework layer build died'))),
  ),
]
