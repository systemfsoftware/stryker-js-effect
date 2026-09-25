import { realpath } from 'node:fs/promises'
import { join } from 'node:path'
import { defineConfig as defineVitestConfig } from 'vitest/config'

import { isAgent, isCI, isOpenTelemetryEnabled } from './env.js'
import { exists, firstExisting, readJson } from './files.js'
import { propertyRuns } from './property-runs.js'

export { isCI }

/** @typedef {import('vitest/config').ViteUserConfig} ViteUserConfig */
/** @typedef {NonNullable<ViteUserConfig['test']>} TestConfig */
/** @typedef {NonNullable<TestConfig['projects']>} Projects */
/**
 * What one config load reads from disk about its own package: the exemption table entry that decides
 * where the guard applies, and the guard setup files its projects take.
 *
 * @typedef {{
 *   readonly exemption: { readonly projects: readonly string[] | '*', readonly registrar: string } | undefined,
 *   readonly guardSetupFiles: ReadonlyArray<string>,
 * }} PackageFacts
 */

/**
 * @param {unknown} value
 * @param {string} key
 * @returns {string}
 */
const stringField = (value, key) => {
  const field = typeof value === 'object' && value !== null ? Reflect.get(value, key) : undefined
  return typeof field === 'string' ? field : ''
}

// Workspace-only: tsdown declares it via devExports and every
// consumer-facing surface strips it, so only in-repo runs see sources.
const sourceCondition = '@systemfsoftware/source'

const forkPackage = '@systemfsoftware/vitest'

/** @typedef {{ readonly projects: readonly string[] | '*', readonly registrar: string }} GuardExemption */

/** @type {GuardExemption} */
const ignorerTester = {
  projects: '*',
  registrar: "the @systemfsoftware/stryker-ignorer-kit tester registers every case with the runner's global it",
}

/**
 * The one table that takes a package's tests out from under the guard. A package is exempt only by being
 * listed here, together with the runner that registers its tests: vitest's own `it` is what the guard
 * refuses, so every test another runner registers must not load it. `projects` is `'*'` when the whole
 * package is exempt, otherwise the names of the exempt inline test projects.
 *
 * @type {Readonly<Record<string, GuardExemption>>}
 */
const guardExemptions = {
  '@systemfsoftware/stryker-ignorer-kit': ignorerTester,
  '@systemfsoftware/stryker-ignorer-angular': ignorerTester,
  '@systemfsoftware/stryker-ignorer-effect-schema-declarations': ignorerTester,
  '@systemfsoftware/stryker-ignorer-in-source-vitest-block': ignorerTester,
  '@systemfsoftware/stryker-vm-harness': {
    projects: '*',
    registrar: "the vm harness runs user-project sandbox suites in-process on the host's vitest it and expect",
  },
}

/**
 * The setup file that installs the guard, as an absolute path. The fork is looked up only where pnpm
 * links a package's declared dependencies, `<package>/node_modules/<fork>`: Node resolution is not
 * used because pnpm's bin shims put the whole virtual store on `NODE_PATH`, so it finds the fork from
 * a package that never declared it. A package that has not declared the fork, or whose fork has no
 * guard on disk, fails config load instead of running unguarded.
 *
 * @param {string} cwd
 * @param {string} name
 * @returns {Promise<string>}
 */
const guardSetupFile = async (cwd, name) => {
  const refuse = (/** @type {string} */ what) =>
    new Error(
      `[@systemfsoftware/vitest-config] ${name} ${what}, so its tests would run without the guard. ` +
        `Declare "${forkPackage}": "catalog:" in devDependencies of ${join(cwd, 'package.json')}, ` +
        `or name the exempt test project in vitest-config's guard exemption table.`,
    )
  const forkDir = join(cwd, 'node_modules', forkPackage)
  const manifestPath = join(forkDir, 'package.json')
  if (!(await exists(manifestPath))) throw refuse(`has no "${forkPackage}" linked in its own node_modules`)
  const exportsField = Reflect.get(Object(await readJson(manifestPath)), 'exports')
  const guardEntry = Reflect.get(Object(exportsField), './guard')
  const found = await firstExisting(
    [stringField(guardEntry, sourceCondition), stringField(guardEntry, 'default')]
      .filter((entry) => entry.length > 0)
      .map((entry) => join(forkDir, entry)),
  )
  if (found === undefined) throw refuse(`links a "${forkPackage}" whose "./guard" export has no file on disk`)
  return realpath(found)
}

/**
 * @param {string} cwd
 * @returns {Promise<PackageFacts>}
 */
const packageFacts = async (cwd) => {
  const name = stringField(await readJson(join(cwd, 'package.json')), 'name')
  const exemption = guardExemptions[name]
  const guardSetupFiles = exemption?.projects === '*' ? [] : [await guardSetupFile(cwd, name)]
  return { exemption, guardSetupFiles }
}

/**
 * A test block with the package's guard setup files added on top of its own, each at most once.
 *
 * @param {TestConfig | undefined} test
 * @param {boolean} guard
 * @param {PackageFacts} facts
 * @returns {TestConfig}
 */
const withSetupFiles = (test, guard, facts) => {
  const own = (test?.setupFiles === undefined ? [] : [test.setupFiles].flat())
    .filter((file) => guard || !facts.guardSetupFiles.includes(file))
  return {
    ...test,
    setupFiles: [...new Set([...own, ...(guard ? facts.guardSetupFiles : [])])],
  }
}

/**
 * @param {TestConfig | undefined} test
 * @param {PackageFacts} facts
 * @returns {boolean}
 */
const isExemptProject = (test, facts) => {
  const names = facts.exemption?.projects
  if (names === undefined || names === '*') return false
  const name = test?.name
  return typeof name === 'string' && names.includes(name)
}

/**
 * @param {unknown} value
 * @returns {value is { readonly test?: TestConfig }}
 */
const isTestProject = (value) => typeof value === 'object' && value !== null && 'test' in value

/**
 * @param {unknown} project
 * @param {PackageFacts} facts
 * @returns {unknown}
 */
const projectWithSetup = (project, facts) => {
  if (!isTestProject(project)) return project
  const test = project.test
  return { ...project, test: withSetupFiles(test, !isExemptProject(test, facts), facts) }
}

/**
 * Vitest's `defineConfig` with the guard added to every block that runs tests: the root when the config
 * declares no projects, otherwise each inline project the exemption table does not name. The config it
 * builds is a promise, because resolving the guard reads the file system.
 *
 * @param {ViteUserConfig} config
 * @returns {Promise<ViteUserConfig>}
 */
export const defineConfig = async (config) => {
  const facts = await packageFacts(process.cwd())
  const declared = config.test?.projects
  const test = declared === undefined
    ? withSetupFiles(config.test, true, facts)
    : {
      ...withSetupFiles(config.test, false, facts),
      projects: /** @type {Projects} */ (declared.map((project) => projectWithSetup(project, facts))),
    }
  return defineVitestConfig({ ...config, test })
}

export const openTelemetry = {
  enabled: isOpenTelemetryEnabled,
  sdkPath: new URL('./otel.js', import.meta.url).pathname,
}

const sharedTestTimeout = isCI ? 30_000 : isAgent ? 15_000 : 8_000

/**
 * @type {ViteUserConfig}
 */
export const sharedConfig = {
  resolve: {
    conditions: [sourceCondition],
    alias: { 'effect/TestClock': '@systemfsoftware/vitest/TestClock' },
  },
  ssr: {
    resolve: {
      conditions: [sourceCondition],
    },
  },
  test: {
    globals: false,
    environment: 'node',
    setupFiles: [],
    includeSource: ['src/**/*.{js,ts}'],
    exclude: ['**/.stryker-tmp/**', '**/node_modules/**', '**/.repo/**'],
    passWithNoTests: true,
    testTimeout: sharedTestTimeout,
    silent: isAgent ? 'passed-only' : false,
    provide: { '@systemfsoftware/vitest:property-check': { runs: propertyRuns } },
    ...(isAgent ? { bail: 1 } : {}),
    coverage: {
      enabled: isCI || process.env['COVERAGE'] === 'true',
      provider: 'v8',
      reporter: ['json', 'html', 'lcov'],
    },
    experimental: { openTelemetry },
  },
}
