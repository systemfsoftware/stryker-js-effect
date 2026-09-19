import type {
  ReporterEvent,
  ReporterFactory,
  ReporterFailed,
  ReporterInit,
  StrykerOptions,
} from '@systemfsoftware/stryker-js-plugin-interface'
import {
  DryRunCompleted,
  MutantTested,
  MutationTestingPlanReady,
  MutationTestReportReady,
  StrykerOptionsSchema,
} from '@systemfsoftware/stryker-js-plugin-interface'

import { makeClearTextReporter } from './clear-text-report.js'
import { type BuiltinReporterServices, makeJsonReporter } from './json-reporter.js'
import { makeProgressBarReporter, makeProgressStreamReporter } from './progress-reporter.js'

export type { BuiltinReporterServices }
export type { ReporterEvent, ReporterFactory, ReporterFailed, ReporterInit, StrykerOptions }
export { DryRunCompleted, MutantTested, MutationTestingPlanReady, MutationTestReportReady, StrykerOptionsSchema }

export const makeBuiltinReporterFactories = (
  services: BuiltinReporterServices,
): Record<string, ReporterFactory> => ({
  'json': makeJsonReporter(services),
  'clear-text': makeClearTextReporter(services),
  'progress': makeProgressBarReporter(services),
  'progress-stream': makeProgressStreamReporter,
})
