import * as Arr from 'effect/Array'
import * as Boolean from 'effect/Boolean'
import * as HashSet from 'effect/HashSet'
import * as Option from 'effect/Option'
import type * as Path from 'effect/Path'
import * as Str from 'effect/String'

export const ISOLATED_DECLARATIONS_PROJECT = 'test/checker-parity/__fixtures__/isolated-declarations/tsconfig.json'

export const CHECKER_PLUGIN = '@systemfsoftware/stryker-js-typescript-checker'

const E2E_CHECKER_CONFIG = /^test\/e2e\/testResources\/[^/]+\/stryker[^/]*\.config\.ts$/u
const WORKSPACE_TSCONFIG_APP = /(?:^|\/)tsconfig\.app\.json$/u
const TSCONFIG_FILE = /tsconfigFile\s*:\s*['"`]([^'"`]+)['"`]/gu
const DECLARATION_FILE = /\.d\.(?:ts|mts|cts)$/u

export interface CorpusEntries {
  readonly workspaceTsconfigs: ReadonlyArray<string>
  readonly e2eConfigs: ReadonlyArray<string>
}

const distinctSorted = (values: ReadonlyArray<string>): ReadonlyArray<string> => Arr.sort(Arr.dedupe(values), Str.Order)

export const corpusEntries = (tracked: ReadonlyArray<string>): CorpusEntries => ({
  workspaceTsconfigs: distinctSorted(tracked.filter((file) => WORKSPACE_TSCONFIG_APP.test(file))),
  e2eConfigs: distinctSorted(tracked.filter((file) => E2E_CHECKER_CONFIG.test(file))),
})

export interface NamedByConfig {
  readonly configText: string
  readonly configDirectory: string
  readonly path: Path.Path
}

const joinRepoRelative = (input: NamedByConfig, value: string): string =>
  Boolean.match(input.path.isAbsolute(value), {
    onTrue: () => value,
    onFalse: () => [input.configDirectory, value].filter(Str.isNonEmpty).join('/'),
  })

/**
 * The tsconfigs a fixture configuration names, repo-relative to the configuration's directory.
 * A configuration that does not reference {@link CHECKER_PLUGIN} names nothing.
 */
export const tsconfigsNamedByConfig = (input: NamedByConfig): ReadonlyArray<string> =>
  Boolean.match(input.configText.includes(CHECKER_PLUGIN), {
    onTrue: () =>
      distinctSorted(
        Arr.getSomes(
          Array.from(input.configText.matchAll(TSCONFIG_FILE), (match) => Option.fromUndefinedOr(match[1])),
        ).map((named) => joinRepoRelative(input, named)),
      ),
    onFalse: Arr.empty,
  })

export interface ProgramListing {
  readonly listing: string
  readonly repoRoot: string
  readonly path: Path.Path
}

const insideRepo = (path: Path.Path, relative: string): boolean =>
  Boolean.every([Str.isNonEmpty(relative), !relative.startsWith('..'), !path.isAbsolute(relative)])

const underNodeModules = (file: string): boolean =>
  HashSet.has(HashSet.fromIterable(file.split(/[/\\]/u)), 'node_modules')

export const programFilesFromListing = (input: ProgramListing): ReadonlyArray<string> =>
  Arr.sort(
    input.listing
      .split('\n')
      .map(Str.trim)
      .filter((line) => Str.isNonEmpty(line) && input.path.isAbsolute(line))
      .filter((file) => !DECLARATION_FILE.test(file) && !underNodeModules(file))
      .map((file) => input.path.relative(input.path.resolve(input.repoRoot), file))
      .filter((relative) => insideRepo(input.path, relative))
      .map((relative) => relative.split(input.path.sep).join('/')),
    Str.Order,
  )
