import type { Ignorer } from '@systemfsoftware/stryker-framework-interface'
import { Framework } from '@systemfsoftware/stryker-js-language'
import { declarePlugin } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Layer from 'effect/Layer'

import { angularFormatService } from './html-format.js'
import { angularSignalIgnorer } from './signal-io-ignorer.js'

export const strykerPlugins = [
  declarePlugin('Framework', 'angular', Layer.succeed(Framework, angularFormatService)),
]

export const strykerIgnorers: readonly Ignorer[] = [angularSignalIgnorer]

export { angularFormatService, angularSignalIgnorer }
