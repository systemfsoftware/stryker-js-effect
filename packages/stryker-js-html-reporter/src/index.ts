import type { ReporterFactory } from '@systemfsoftware/stryker-js-language'
import { declarePlugin } from '@systemfsoftware/stryker-js-plugin-interface'

import { makeHtmlReporter } from './Reporter.js'

export { makeHtmlReporter } from './Reporter.js'

export const htmlReporterFactory: ReporterFactory = makeHtmlReporter

export const strykerPlugins = [declarePlugin('Reporter', 'html', htmlReporterFactory)]
