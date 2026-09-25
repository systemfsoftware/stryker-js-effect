import { globSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
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
  disableBail: true,
  cleanTempDir: 'always',
  thresholds: { high: 100, low: 80, break: 100 },
  ...(envConcurrency !== undefined ? { concurrency: envConcurrency } : {}),
}

const SHARD = /^(\d+)\/(\d+)$/
const MUTATION_RANGE = /:\d+(?::\d+)?-\d+(?::\d+)?$/

/**
 * The shard `STRYKER_SHARD` names, or `undefined` when it is unset or empty.
 * @param {string | undefined} raw
 * @returns {{ readonly index: number, readonly count: number } | undefined}
 */
function parseShard(raw) {
  if (raw === undefined || raw === '') return undefined
  const match = SHARD.exec(raw)
  const index = Number(match?.[1])
  const count = Number(match?.[2])
  if (match === null || count < 1 || index < 1 || index > count) {
    throw new Error(`STRYKER_SHARD must be <index>/<count> with 1 <= index <= count, got '${raw}'.`)
  }
  return { index, count }
}

/**
 * The files `shard` owns: sorted, file i goes to shard ((i + rotation) mod
 * count) + 1, with the rotation hashed from `packageName` so packages with
 * fewer files than shards do not all start on shard 1. Over every shard of a
 * count, the slices partition `files`.
 * @param {readonly string[]} files
 * @param {string} packageName
 * @param {{ readonly index: number, readonly count: number }} shard
 * @returns {string[]}
 */
function sliceFiles(files, packageName, shard) {
  let hash = 0x811c9dc5
  for (const char of packageName) hash = Math.imul(hash ^ char.charCodeAt(0), 0x01000193) >>> 0
  const rotation = hash % shard.count
  return [...new Set(files)].sort().filter((_, position) => (position + rotation) % shard.count === shard.index - 1)
}

/**
 * @param {unknown} cause
 * @returns {string}
 */
const reason = (cause) => (cause instanceof Error ? cause.message : String(cause))

/**
 * The `name` of the `package.json` beside the Stryker config, or a `shardMutate`
 * diagnostic naming the path it looked for and the cause it hit.
 * @returns {string}
 */
function readPackageName() {
  const path = resolve('package.json')
  try {
    return JSON.parse(readFileSync(path, 'utf8')).name
  } catch (cause) {
    throw new Error(`shardMutate needs package.json next to the Stryker config at ${path}: ${reason(cause)}`, { cause })
  }
}

/**
 * `patterns` for the shard `STRYKER_SHARD=<index>/<count>` names; unchanged when
 * it is unset.
 *
 * The shard keeps every pattern and negates each expanded file another shard
 * owns, so Stryker's own matcher still decides the file set. A file Stryker
 * matches that this expansion misses is mutated by every shard rather than by
 * none, and the report job refuses the overlap instead of losing it.
 * @param {readonly string[]} patterns
 * @returns {string[]}
 */
export function shardMutate(patterns) {
  const shard = parseShard(process.env['STRYKER_SHARD'])
  if (shard === undefined) return [...patterns]
  const ranged = patterns.filter((pattern) => MUTATION_RANGE.test(pattern))
  if (ranged.length > 0) {
    throw new Error(`shardMutate cannot slice mutation ranges: ${ranged.join(', ')}.`)
  }
  const include = patterns.filter((pattern) => !pattern.startsWith('!'))
  const exclude = patterns.filter((pattern) => pattern.startsWith('!')).map((pattern) => pattern.slice(1))
  const files = globSync(include, { exclude })
  const owned = new Set(sliceFiles(files, readPackageName(), shard))
  return [...patterns, ...files.filter((file) => !owned.has(file)).map((file) => `!${file}`)]
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
