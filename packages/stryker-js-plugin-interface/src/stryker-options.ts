import * as S from 'effect/Schema'

import {
  CheckerCustomConfigSchema,
  TestRunnerCustomConfigSchema,
} from './stryker-options.schema.js'

export {
  CoverageAnalysisMode,
  LogLevel,
  PackageManager,
  ReportType,
  StrykerOptionsSchema,
} from './stryker-options.schema.js'
export type {
  CheckerCustomConfig,
  CheckerEntryConfig,
  CoverageAnalysisMode as CoverageAnalysisModeType,
  LogLevel as LogLevelType,
  PackageManager as PackageManagerType,
  PartialStrykerOptions,
  ReportType as ReportTypeType,
  StrykerOptions,
  TestRunnerConfig,
  TestRunnerCustomConfig,
} from './stryker-options.schema.js'

export const isCustomTestRunner = S.is(TestRunnerCustomConfigSchema)

