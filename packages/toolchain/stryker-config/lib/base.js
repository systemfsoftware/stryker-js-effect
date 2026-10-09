import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

const isAgent = process.env['AGENT'] !== undefined
const isCI = !isAgent && typeof process.env['CI'] === 'string' && process.env['CI'].length > 0

const envConcurrency = process.env['STRYKER_CONCURRENCY'] ??
  (isAgent ? '50%' : isCI ? '100%' : undefined)

export const sharedConfig = {
  packageManager: 'pnpm',
  reporters: isAgent || isCI ? ['json', 'html'] : ['progress', 'html', 'json'],
  htmlReporter: { fileName: 'reports/mutation-report.html' },
  jsonReporter: { fileName: 'reports/mutation-report.json' },
  coverageAnalysis: 'perTest',
  incremental: true,
  incrementalFile: 'reports/stryker-incremental.json',
  ignorePatterns: ['reports', 'coverage'],
  cleanTempDir: 'always',
  thresholds: { high: 100, low: 80, break: 100 },
  ...(envConcurrency !== undefined ? { concurrency: envConcurrency } : {}),
}

/**
 * A `file:` URL for `specifier` as the package manager installed it beside the
 * config.
 *
 * A package must not resolve its own name with `import.meta.resolve`: Node's
 * package self-reference short-circuits the `node_modules` lookup to the
 * package's own `exports`, i.e. its unbuilt `dist`, not the installed copy the
 * dogfood lane runs. Requiring from `<config dir>/node_modules/` walks the
 * installed layout instead, so the resolved URL is the package manager's copy
 * under the virtual store, never the package's own build output.
 * @param {string} specifier bare package name
 * @param {string | URL} configUrl the importing config's `import.meta.url`
 * @returns {string}
 */
export function installedPlugin(specifier, configUrl) {
  return pathToFileURL(createRequire(new URL('./node_modules/', configUrl)).resolve(specifier)).href
}
