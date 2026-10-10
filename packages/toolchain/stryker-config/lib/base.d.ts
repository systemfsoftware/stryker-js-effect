export interface SharedConfig {
  [key: string]: unknown
  packageManager: 'pnpm'
  reporters: string[]
  htmlReporter: { fileName: string }
  jsonReporter: { fileName: string }
  coverageAnalysis: 'perTest'
  incremental: boolean
  incrementalFile: string
  incrementalSources: string[]
  ignorePatterns: string[]
  cleanTempDir: 'always'
  thresholds: { high: number; low: number; break: number }
  concurrency?: string
  disableBail?: boolean
  mutator?: { mutantSetPolicy: 'default' | 'full'; [key: string]: unknown }
}

export const sharedConfig: SharedConfig

export function installedPlugin(specifier: string, configUrl: string | URL): string
