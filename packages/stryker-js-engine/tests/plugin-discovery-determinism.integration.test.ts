import { Gherkin, Given, it, layer, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import type { LoadedPlugins, PluginLoadFailedError } from '@systemfsoftware/stryker-js-engine/plugin-loader'
import { loadPlugins } from '@systemfsoftware/stryker-js-engine/plugin-loader'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as Layer from 'effect/Layer'
import * as Match from 'effect/Match'
import * as Path from 'effect/Path'
import { expect } from 'vitest'

import { isExtensionClaimShadowing, pluginEnvironmentLayer } from './__fixtures__/loader-support.js'

/**
 * KTD6/U2: when two plugins claim one file extension, the winner must be the
 * module that sorts first rather than whichever the multi-root union surfaces
 * first. Discovery runs here with an injected FileSystem layer answering the
 * engine's own install folder and the workspace install folder, so the listing
 * order varies per run while module import and the claim fold stay real. The
 * scoped-org qualification for the default `@systemfsoftware/stryker-js-*`
 * expression stays unexercised here, because the injected listing yields
 * descriptors directly.
 */
const pathService: Path.Path = Effect.runSync(
  Effect.gen(function*() {
    return yield* Path.Path
  }).pipe(Effect.provide(Path.layer)),
)

const TEST_DIRECTORY = pathService.dirname(Effect.runSync(pathService.fromFileUrl(new URL(import.meta.url))))
const FIXTURE_DIRECTORY = pathService.join(TEST_DIRECTORY, '__fixtures__')
const ENGINE_PACKAGE_DIRECTORY = pathService.dirname(TEST_DIRECTORY)

const WILDCARD_PLUGIN_EXPRESSION = '*'

const HTML_CLAIMING_FIXTURES: readonly [string, string] = [
  'determinism-html-alpha.fixture.mjs',
  'determinism-html-beta.fixture.mjs',
]

const byteOrderedFixtures = (fixtures: readonly [string, string]): readonly [string, string] =>
  Match.value(fixtures[0] < fixtures[1]).pipe(
    Match.when(true, (): readonly [string, string] => [fixtures[0], fixtures[1]]),
    Match.orElse((): readonly [string, string] => [fixtures[1], fixtures[0]]),
  )

const FIXTURES_IN_BYTE_ORDER = byteOrderedFixtures(HTML_CLAIMING_FIXTURES)

const WINNING_FIXTURE = FIXTURES_IN_BYTE_ORDER[0]
const SHADOWED_FIXTURE = FIXTURES_IN_BYTE_ORDER[1]
const SHADOWED_FIXTURE_FORMAT_ID = 'html-beta'

const fixtureDescriptor = (fixtureName: string): string => pathService.join(FIXTURE_DIRECTORY, fixtureName)

const IGNORED_DIRECTORY_ENTRIES: readonly string[] = ['.bin', 'stryker']

const DIRECTORY_ENTRIES: readonly string[] = [
  ...HTML_CLAIMING_FIXTURES.map(fixtureDescriptor),
  ...IGNORED_DIRECTORY_ENTRIES,
]

type DirectoryReadOrder = 'in listed order' | 'in reverse' | 'with the last entry first' | 'in shuffled order'

const SHUFFLE_SEED = 7

const seededKey = (entry: string): number =>
  Array.from(entry).reduce(
    (hash, character) => (hash * 31 + (character.codePointAt(0) ?? 0)) % 2_147_483_647,
    SHUFFLE_SEED,
  )

const READ_ORDERS: Record<DirectoryReadOrder, (entries: readonly string[]) => readonly string[]> = {
  'in listed order': (entries) => [...entries],
  'in reverse': (entries) => [...entries].reverse(),
  'with the last entry first': (entries) => [...entries.slice(-1), ...entries.slice(0, -1)],
  'in shuffled order': (entries) => [...entries].sort((left, right) => seededKey(left) - seededKey(right)),
}

interface InstallRootReadOrders {
  readonly near: DirectoryReadOrder
  readonly far: DirectoryReadOrder
}

const READ_ORDER_ROWS = [
  { near: 'in listed order', far: 'in listed order' },
  { near: 'in reverse', far: 'in listed order' },
  { near: 'in listed order', far: 'in shuffled order' },
  { near: 'with the last entry first', far: 'in reverse' },
] as const

const normalizeDirectory = (directory: string): string => pathService.resolve(directory)

const NEAR_INSTALL_ROOT = normalizeDirectory(pathService.join(ENGINE_PACKAGE_DIRECTORY, 'node_modules'))
const FAR_INSTALL_ROOT = normalizeDirectory(
  pathService.join(pathService.resolve(ENGINE_PACKAGE_DIRECTORY, '..', '..'), 'node_modules'),
)

const EMPTY_DIRECTORY_ENTRIES: readonly string[] = []

interface InstallRootListings {
  readonly near: readonly string[]
  readonly far: readonly string[]
}

const listingsFor = (orders: InstallRootReadOrders): InstallRootListings => ({
  near: READ_ORDERS[orders.near](DIRECTORY_ENTRIES),
  far: READ_ORDERS[orders.far](DIRECTORY_ENTRIES),
})

const entriesListedIn = (listings: InstallRootListings, directory: string): readonly string[] =>
  Match.value(normalizeDirectory(directory)).pipe(
    Match.when(NEAR_INSTALL_ROOT, () => listings.near),
    Match.when(FAR_INSTALL_ROOT, () => listings.far),
    Match.orElse(() => EMPTY_DIRECTORY_ENTRIES),
  )

const injectedFileSystemLayer = (listings: InstallRootListings): Layer.Layer<FileSystem.FileSystem> =>
  FileSystem.layerNoop({
    readDirectory: (directory) => Effect.succeed([...entriesListedIn(listings, directory)]),
  })

const discoverPlugins = (
  orders: InstallRootReadOrders,
): Effect.Effect<LoadedPlugins, PluginLoadFailedError> => {
  const reader = injectedFileSystemLayer(listingsFor(orders))
  return loadPlugins([WILDCARD_PLUGIN_EXPRESSION], process.cwd()).pipe(
    Effect.provide(reader),
    Effect.provide(pluginEnvironmentLayer),
  )
}

interface ExtensionShadowingIdentity {
  readonly extension: string
  readonly formatId: string
  readonly winnerModule: string
  readonly loserModule: string
}

interface DiscoveryIdentity {
  readonly loadedModules: readonly string[]
  readonly extensionShadowings: readonly ExtensionShadowingIdentity[]
}

const moduleFileNameOf = (moduleName: string): string => pathService.basename(moduleName)

const discoveryIdentityOf = (loaded: LoadedPlugins): DiscoveryIdentity => ({
  loadedModules: loaded.outcomes
    .filter((outcome) => outcome.outcome === 'loaded')
    .map((outcome) => moduleFileNameOf(outcome.moduleName)),
  extensionShadowings: loaded.shadowings.filter(isExtensionClaimShadowing).map((shadowing) => ({
    extension: shadowing.extension,
    formatId: shadowing.formatId,
    winnerModule: moduleFileNameOf(shadowing.winnerModule),
    loserModule: moduleFileNameOf(shadowing.loserModule),
  })),
})

const EXPECTED_IDENTITY: DiscoveryIdentity = {
  loadedModules: [...FIXTURES_IN_BYTE_ORDER],
  extensionShadowings: [
    {
      extension: '.html',
      formatId: SHADOWED_FIXTURE_FORMAT_ID,
      winnerModule: WINNING_FIXTURE,
      loserModule: SHADOWED_FIXTURE,
    },
  ],
}

const Feature = makeFeature({ it, layer })

Feature('Choosing which framework plugin owns a file extension')
  .body(({ scenario, scenarioOutline }) => {
    scenarioOutline(
      'The plugin that sorts first keeps the extension however the two install folders are read: <near>, <far>',
      READ_ORDER_ROWS,
      (row) =>
        Gherkin.Do.pipe(
          Given('two install folders holding plugins that claim the same file extension')(
            'readOrders',
            (): Effect.Effect<InstallRootReadOrders> => Effect.succeed(row),
          ),
          When('the engine discovers its plugins')('discovered', (s) => discoverPlugins(s.readOrders)),
          Then('the plugin that sorts first owns the extension and the other is reported as shadowed')((s) =>
            Effect.sync(() => {
              expect(discoveryIdentityOf(s.discovered)).toStrictEqual(EXPECTED_IDENTITY)
              expect(s.discovered.shadowings).toHaveLength(1)
            })
          ),
        ),
    )

    scenario(
      'A repeated run and a second read order resolve the same owner and the same shadowed plugin',
      Gherkin.Do.pipe(
        Given('two install folders read in one order, then the same order again, then a different order')(
          'readOrders',
          (): Effect.Effect<readonly InstallRootReadOrders[]> =>
            Effect.succeed([
              { near: 'in reverse', far: 'in shuffled order' },
              { near: 'in reverse', far: 'in shuffled order' },
              { near: 'with the last entry first', far: 'in listed order' },
            ]),
        ),
        When('the engine discovers its plugins once per read order')(
          'discoveries',
          (s) =>
            Effect.forEach(s.readOrders, discoverPlugins).pipe(Effect.map((runs) => runs.map(discoveryIdentityOf))),
        ),
        Then('every run names the same owning plugin and the same shadowed plugin')((s) =>
          Effect.sync(() => {
            const [first, repeated, secondOrder] = s.discoveries
            expect(repeated).toStrictEqual(first)
            expect(secondOrder).toStrictEqual(first)
            expect(first).toStrictEqual(EXPECTED_IDENTITY)
          })
        ),
      ),
    )
  })
