export interface SharedConfig {
  [key: string]: unknown
  packageManager: 'pnpm'
  reporters: string[]
  htmlReporter: { fileName: string }
  jsonReporter: { fileName: string }
  coverageAnalysis: 'perTest'
  incremental: boolean
  incrementalFile: string
  ignorePatterns: string[]
  disableBail: boolean
  cleanTempDir: 'always'
  thresholds: { high: number; low: number; break: number }
  concurrency?: string
}

export const sharedConfig: SharedConfig

export function shardMutate(patterns: readonly string[]): string[]

export function installedPlugin(specifier: string, configUrl: string | URL): string
