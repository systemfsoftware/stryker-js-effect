export interface SharedConfig {
  [key: string]: unknown
  packageManager: 'pnpm'
  testRunner: 'vitest'
  checkers: string[]
  reporters: string[]
  htmlReporter: { fileName: string }
  jsonReporter: { fileName: string }
  vitest: { configFile: string; dir: string; related: boolean }
  typescriptChecker: { prioritizePerformanceOverAccuracy: boolean }
  coverageAnalysis: 'perTest'
  incremental: boolean
  incrementalFile: string
  ignorePatterns: string[]
  disableBail: boolean
  cleanTempDir: 'always'
  ignorers: string[]
  thresholds: { high: number; low: number; break: number }
  mutate: string[]
  concurrency?: string
}

export function createSharedConfig<T extends object = object>(
  overrides?: T,
): SharedConfig & T

declare const sharedConfig: SharedConfig

export { sharedConfig }
