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

const refusalOf = (text: string): string =>
  Result.match(parseFixtureManifest('fixture/package.json', new TextEncoder().encode(text)), {
    onFailure: (failure) => failure.message,
    onSuccess: () => 'decoded',
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
      'A manifest whose key must be escaped in JSON is refused and the refusal names that key',
      [
        { key: 'a lone surrogate', text: '{"name":"fixture","\\ud800":"1"}', at: 'at ["\\ud800"]' },
        { key: 'NUL', text: '{"name":"fixture","\\u0000":"1"}', at: 'at ["\\u0000"]' },
        { key: 'a trailing backslash', text: '{"name":"fixture","x\\\\":"1"}', at: 'at ["x\\\\"]' },
        {
          key: 'a trailing backslash inside dependencies',
          text: '{"name":"fixture","dependencies":{"x\\\\":"1"}}',
          at: 'at ["dependencies"]["x\\\\"]',
        },
      ],
      ({ key, text, at }) =>
        Gherkin.Do.pipe(
          Given(`a fixture manifest with a key holding ${key}`)('text', () => Effect.succeed(text)),
          When('the manifest is read')('refusal', (s) => Effect.succeed(refusalOf(s.text))),
          Then('the manifest is refused at that key')((s, expect) => expect(s.refusal).toContain(at)),
        ),
    )
  })
