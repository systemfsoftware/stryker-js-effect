// R6 corpus discovery: which tsconfigs are projects, and which of a program's files are mutable.
import { createRequire } from 'node:module'
import * as path from 'node:path'

/** The `isolatedDeclarations` fixture, the project the shortcut gate measures on its own. */
export const ISOLATED_DECLARATIONS_PROJECT = 'test/checker-parity/fixtures/isolated-declarations/tsconfig.json'

/** The plugin package whose presence makes an e2e fixture configuration a corpus project. */
export const CHECKER_PLUGIN = '@systemfsoftware/stryker-js-typescript-checker'

const E2E_CHECKER_CONFIG = /^test\/e2e\/testResources\/[^/]+\/stryker[^/]*\.config\.ts$/u
const TSCONFIG_FILE = /tsconfigFile\s*:\s*['"`]([^'"`]+)['"`]/gu
const DECLARATION_FILE = /\.d\.(?:ts|mts|cts)$/u

/** Whether a tracked path is one of the checker-enabled e2e fixture configurations. */
export const isE2eCheckerConfigPath = (trackedPath: string): boolean => E2E_CHECKER_CONFIG.test(trackedPath)

/** Whether a tracked path is a workspace `tsconfig.app.json`. */
export const isWorkspaceTsconfigApp = (trackedPath: string): boolean =>
  trackedPath === 'tsconfig.app.json' || trackedPath.endsWith('/tsconfig.app.json')

/**
 * The corpus sources a `git ls-files` listing names: workspace tsconfigs and the e2e
 * configurations whose text must still be read to find their `tsconfigFile`.
 */
export interface CorpusEntries {
  readonly workspaceTsconfigs: readonly string[]
  readonly e2eConfigs: readonly string[]
}

export const corpusEntries = (tracked: readonly string[]): CorpusEntries => ({
  workspaceTsconfigs: distinctSorted(tracked.filter(isWorkspaceTsconfigApp)),
  e2eConfigs: distinctSorted(tracked.filter(isE2eCheckerConfigPath)),
})

const distinctSorted = (values: readonly string[]): readonly string[] => [...new Set(values)].sort()

const joinRepoRelative = (directory: string, value: string): string =>
  path.isAbsolute(value) ? value : directory.length === 0 ? value : `${directory}/${value}`

/**
 * The tsconfigs a fixture configuration names, repo-relative to the configuration's directory.
 *
 * A configuration that does not reference {@link CHECKER_PLUGIN} names nothing: it is not a
 * checker-parity project. A named path is resolved relative to the configuration's directory, so
 * `tsconfig.json` in `test/e2e/testResources/x/stryker.config.ts` reads
 * `test/e2e/testResources/x/tsconfig.json`.
 */
export const tsconfigsNamedByConfig = (
  configText: string,
  configDirectory: string,
): readonly string[] =>
  configText.includes(CHECKER_PLUGIN)
    ? distinctSorted(
      [...configText.matchAll(TSCONFIG_FILE)].map((match) => joinRepoRelative(configDirectory, match[1] ?? '')),
    )
    : []

/**
 * The program's repo-relative, mutable source files from the TS7 `tsc --listFilesOnly` listing:
 * declaration files, anything under `node_modules`, and anything outside the repository are
 * dropped.
 */
export const programFilesFromListing = (
  listing: string,
  repoRoot: string,
): readonly string[] => {
  const absoluteRepo = path.resolve(repoRoot)
  return listing
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && path.isAbsolute(line))
    .filter((file) => !DECLARATION_FILE.test(file))
    .filter((file) => !file.split(/[/\\]/u).includes('node_modules'))
    .map((file) => path.relative(absoluteRepo, file))
    .filter((relative) => relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative))
    .map((relative) => relative.split(path.sep).join('/'))
    .sort()
}

/** The `tsc` entry point resolved from the installed `typescript` package.json. */
export const tscBinPath = (
  packageJson: { readonly bin?: { readonly tsc?: string | undefined } | undefined },
  packageJsonPath: string,
): string => path.resolve(path.dirname(packageJsonPath), packageJson.bin?.tsc ?? 'bin/tsc')

const requireFromHere = createRequire(import.meta.url)

/** Absolute path of the installed `typescript` package.json. */
export const typescriptPackageJsonPath = (): string => requireFromHere.resolve('typescript/package.json')
