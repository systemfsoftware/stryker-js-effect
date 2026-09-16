import type { Ignorer } from '@systemfsoftware/stryker-framework-interface'
import { Framework } from '@systemfsoftware/stryker-js-language'
import { declarePlugin } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'

import { angularFormatService, resolveParserVersion } from './html-format.js'
import { angularSignalIgnorer } from './signal-io-ignorer.js'

const frameworkLayer = Layer.effect(
  Framework,
  Effect.gen(function*() {
    return angularFormatService(yield* resolveParserVersion)
  }),
)

export const strykerPlugins = [
  declarePlugin('Framework', 'angular', frameworkLayer),
]

export const strykerIgnorers: readonly Ignorer[] = [angularSignalIgnorer]

export { angularFormatService, angularSignalIgnorer }
