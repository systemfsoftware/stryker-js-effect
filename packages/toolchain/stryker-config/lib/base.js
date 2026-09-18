import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
export { defineConfig } from '@systemfsoftware/stryker-js/config'

const require = createRequire(import.meta.url)
/** @param {string} name */
const plugin = (name) => pathToFileURL(require.resolve(name)).href

const isAgent = process.env['AGENT'] !== undefined
const isCI = !isAgent && typeof process.env['CI'] === 'string' && process.env['CI'].length > 0

const envConcurrency = process.env['STRYKER_CONCURRENCY'] ??
  (isAgent ? '50%' : isCI ? '100%' : undefined)

/**
 * @param {import('@systemfsoftware/stryker-js/config').StrykerConfig} [overrides]
 * @returns {import('@systemfsoftware/stryker-js/config').StrykerConfig}
 */
export const createSharedConfig = (overrides = {}) => ({
  packageManager: 'pnpm',
  testRunner: 'vitest',
  checkers: ['typescript'],
  plugins: [
    plugin('@systemfsoftware/stryker-js-vitest-runner'),
    plugin('@systemfsoftware/stryker-js-typescript-checker'),
    plugin('@systemfsoftware/stryker-test-contribution'),
    plugin('@systemfsoftware/stryker-ignorer-effect-schema-declarations'),
    plugin('@systemfsoftware/stryker-ignorer-in-source-vitest-block'),
  ],
  reporters: isAgent || isCI ? ['json', 'html'] : ['progress', 'html', 'json'],
  htmlReporter: { fileName: 'reports/mutation-report.html' },
  jsonReporter: { fileName: 'reports/mutation-report.json' },
  vitest: { configFile: 'vitest.config.ts', dir: '.', related: true },
  typescriptChecker: { prioritizePerformanceOverAccuracy: true },
  coverageAnalysis: 'perTest',
  incremental: true,
  incrementalFile: 'reports/stryker-incremental.json',
  ignorePatterns: ['reports', 'coverage'],
  disableBail: true,
  cleanTempDir: 'always',
  ignorers: ['effect-schema-declarations', 'in-source-vitest-block'],
  thresholds: { high: 100, low: 80, break: 100 },
  mutate: [
    'src/**/*.workflow.ts',
    '!src/**/*.test.ts',
    '!src/**/*.property.test.ts',
    '!src/**/*.d.ts',
    '!src/**/__tests__/**',
  ],
  ...(envConcurrency !== undefined ? { concurrency: envConcurrency } : {}),
  ...overrides,
})

export const sharedConfig = createSharedConfig()
