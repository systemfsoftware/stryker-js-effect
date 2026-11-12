import { NodeFileSystem, NodePath } from '@effect/platform-node'
import { Gherkin, Given, it, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import { parseFixtureManifest, parseWorkspaceCatalogs, resolvedManifestText } from '@systemfsoftware/stryker-e2e-core'
import * as Arr from 'effect/Array'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as Layer from 'effect/Layer'
import * as Path from 'effect/Path'
import * as Result from 'effect/Result'

const Feature = makeFeature({ it })

const PORTS = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer)

const RESOURCES_URL = new URL('../../e2e/testResources', import.meta.url)

const WORKSPACE_URL = new URL('../../../pnpm-workspace.yaml', import.meta.url)

const MANIFEST_FILE = 'package.json'

const isFixtureManifest = (relativePath: string): boolean => {
  const segments = relativePath.split('/')
  return segments.at(-1) === MANIFEST_FILE && !segments.includes('node_modules')
}

const resolveEveryFixtureManifest = Effect.gen(function*() {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const resources = yield* path.fromFileUrl(RESOURCES_URL)
  const catalogs = parseWorkspaceCatalogs(yield* fs.readFileString(yield* path.fromFileUrl(WORKSPACE_URL)))
  const manifests = Arr.filter(yield* fs.readDirectory(resources, { recursive: true }), isFixtureManifest)
  const outcomes = yield* Effect.forEach(manifests, (manifest) =>
    Effect.map(
      fs.readFile(path.join(resources, manifest)),
      (bytes) => [manifest, resolvedManifestText(manifest, bytes, catalogs)] as const,
    ))
  return {
    manifests: manifests.length,
    refused: outcomes.flatMap(([, outcome]) =>
      Result.match(outcome, { onFailure: (failure) => [failure.message], onSuccess: () => [] })
    ),
  }
})

type FixtureDocument = Readonly<Record<string, string | Readonly<Record<string, string>>>>

const manifestBytesOf = (document: FixtureDocument): Uint8Array => new TextEncoder().encode(JSON.stringify(document))

const readBackOf = (document: FixtureDocument): string =>
  Result.match(parseFixtureManifest('fixture/package.json', manifestBytesOf(document)), {
    onFailure: (failure) => failure.message,
    onSuccess: (manifest) => JSON.stringify(manifest),
  })

Feature('Reading e2e fixture manifests')
  .withLayer(PORTS)
  .live('the committed fixture manifests are read from the repository, offline')
  .body(({ scenario, scenarioOutline }) => {
    scenario(
      'Every committed fixture manifest resolves against the workspace catalogs',
      Gherkin.Do.pipe(
        Given('the e2e fixtures under test/e2e/testResources')('resources', () => Effect.succeed(RESOURCES_URL.href)),
        When('each committed package.json is resolved against pnpm-workspace.yaml')(
          'resolved',
          () => resolveEveryFixtureManifest,
        ),
        Then('no manifest is refused')((s, expect) =>
          expect({ read: s.resolved.manifests > 0, refused: s.resolved.refused.join('\n') }).toStrictEqual({
            read: true,
            refused: '',
          })
        ),
      ),
    )

    scenarioOutline(
      'A manifest keeps a key that needs a JSON escape after a manifest with a key ending in a backslash was read',
      [
        { key: 'a lone surrogate', lead: 'nodejs-63785-surrogate', escaped: '\ud800', nested: false },
        { key: 'NUL', lead: 'nodejs-63785-nul', escaped: '\u0000', nested: false },
        { key: 'a tab', lead: 'nodejs-63785-tab', escaped: '\t', nested: false },
        { key: 'a quote', lead: 'nodejs-63785-quote', escaped: '"', nested: false },
        { key: 'a lone surrogate inside dependencies', lead: 'nodejs-63785-nested', escaped: '\ud800', nested: true },
      ],
      ({ key, lead, escaped, nested }) =>
        Gherkin.Do.pipe(
          Given(`a manifest with the key "${lead}" followed by a key ending in a backslash has been read`)(
            'primed',
            () =>
              Effect.succeed(
                readBackOf(nested ? { dependencies: { [lead]: '0', '\\': '0' } } : { [lead]: '0', '\\': '0' }),
              ),
          ),
          Given(`a manifest with the key "${lead}" followed by a key holding ${key}`)(
            'document',
            () =>
              Effect.succeed(
                nested ? { dependencies: { [lead]: '0', [escaped]: '1' } } : { [lead]: '0', [escaped]: '1' },
              ),
          ),
          When('the manifest is read')('read', (s) => Effect.succeed(readBackOf(s.document))),
          Then('it decodes to the document that was written, key for key')((s, expect) =>
            expect(s.read).toStrictEqual(JSON.stringify(s.document))
          ),
        ),
    )
  })
