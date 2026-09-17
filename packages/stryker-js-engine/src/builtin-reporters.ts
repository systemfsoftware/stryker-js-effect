import type { ReporterFactory } from '@systemfsoftware/stryker-js-language'

import { makeClearTextReporter } from './clear-text-report.js'
import { type BuiltinReporterServices, type JsonReporterDeps, makeJsonReporter } from './json-reporter.js'
import { makeProgressBarReporter, makeProgressStreamReporter } from './progress-reporter.js'

export type { BuiltinReporterServices, JsonReporterDeps }

export const makeBuiltinReporterFactories = (
  services: BuiltinReporterServices,
): Record<string, ReporterFactory> => ({
  'json': makeJsonReporter(services),
  'clear-text': makeClearTextReporter(services),
  'progress': makeProgressBarReporter(services),
  'progress-stream': makeProgressStreamReporter,
})
