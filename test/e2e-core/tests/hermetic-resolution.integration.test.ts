import { NodeFileSystem, NodePath } from '@effect/platform-node'
import * as NodeChildProcessSpawner from '@effect/platform-node/NodeChildProcessSpawner'
import * as NodeHttpServer from '@effect/platform-node/NodeHttpServer'
import { Gherkin, Given, it, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as Layer from 'effect/Layer'
import * as Path from 'effect/Path'
import { ChildProcess, ChildProcessSpawner } from 'effect/process'
import * as S from 'effect/Schema'
import * as Stream from 'effect/Stream'

import {
  NpmLockfileJson,
  pinnedFieldsOf,
  PinnedFixtureManifestJson,
  REGISTRY_CUTOFF,
  registryPinsOf,
} from '@systemfsoftware/stryker-e2e-core'
import { type Registry, serveRegistry } from './__fixtures__/local-registry.js'

const Feature = makeFeature({ it })

const FILE_AND_PATH = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer)

const PORTS = Layer.mergeAll(
  FILE_AND_PATH,
  NodeChildProcessSpawner.layer.pipe(Layer.provide(FILE_AND_PATH)),
  Layer.orDie(NodeHttpServer.layerTest),
)

const BEFORE_CUTOFF = '2026-10-01T03:11:28.537Z'
const AFTER_CUTOFF = '2026-10-10T10:04:06.183Z'

const REGISTRY: Registry = {
  effect: [
    { version: '4.0.0', time: BEFORE_CUTOFF },
    { version: '4.0.2', time: '2026-10-07T18:21:31.965Z' },
  ],
  '@effect/platform-node': [
    { version: '4.0.0', time: BEFORE_CUTOFF, peerDependencies: { effect: '^4.0.0' } },
    { version: '4.0.3', time: AFTER_CUTOFF, peerDependencies: { effect: '^4.0.3' } },
  ],
  'left-pad': [
    { version: '1.0.0', time: BEFORE_CUTOFF },
    { version: '1.1.0', time: AFTER_CUTOFF },
  ],
  'packed-cli': [
    {
      version: '1.0.0',
      time: BEFORE_CUTOFF,
      dependencies: { '@effect/platform-node': '^4.0.0', 'left-pad': '^1.0.0' },
    },
  ],
}

const ROOT_LOCKFILE = [
  "lockfileVersion: '9.0'",
  '',
  'packages:',
  '',
  "  '@effect/platform-node@4.0.0':",
  '    resolution: {integrity: sha512-pinned}',
  '',
  '  effect@4.0.0:',
  '    resolution: {integrity: sha512-pinned}',
  '',
  'snapshots:',
  '',
  "  '@effect/platform-node@4.0.0(effect@4.0.0)':",
  '    dependencies:',
  '      effect: 4.0.0',
  '',
].join('\n')

const FIXTURE_MANIFEST = {
  name: 'fixture',
  version: '0.0.0',
  private: true,
  devDependencies: { effect: '^4.0.0', 'packed-cli': '^1.0.0' },
}

const runNpm = (args: ReadonlyArray<string>, cwd: string) =>
  Effect.scoped(Effect.gen(function*() {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
    const handle = yield* spawner.spawn(ChildProcess.make('npm', [...args], { cwd }))
    const [stderr, exitCode] = yield* Effect.all(
      [handle.stderr.pipe(Stream.decodeText, Stream.mkString), handle.exitCode],
      { concurrency: 'unbounded' },
    )
    return { exitCode, stderr }
  }))

const resolveFixture = (published: Registry) =>
  Effect.scoped(Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const registry = yield* serveRegistry(published)
    const root = yield* fs.makeTempDirectoryScoped({ prefix: 'hermetic-resolution-' })
    const fixture = path.join(root, 'fixture')
    yield* fs.makeDirectory(fixture)
    const pins = registryPinsOf(ROOT_LOCKFILE)
    const pinned = { ...FIXTURE_MANIFEST, ...pinnedFieldsOf({ manifest: FIXTURE_MANIFEST, pins, root: true }) }
    yield* fs.writeFileString(
      path.join(fixture, 'package.json'),
      yield* S.encodeEffect(PinnedFixtureManifestJson)(pinned),
    )
    const outcome = yield* runNpm([
      'install',
      '--package-lock-only',
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
      `--before=${REGISTRY_CUTOFF}`,
      `--registry=${registry}`,
      `--cache=${path.join(root, 'npm-cache')}`,
      `--userconfig=${path.join(root, 'npmrc')}`,
    ], fixture)
    const lockfile = yield* fs.readFileString(path.join(fixture, 'package-lock.json')).pipe(
      Effect.flatMap(S.decodeEffect(NpmLockfileJson)),
    )
    const resolved = Object.fromEntries(
      Object.entries(lockfile.packages)
        .filter(([location]) => location !== '')
        .map(([location, entry]) => [location.replace(/^node_modules\//, ''), entry.version ?? '']),
    )
    return { exitCode: outcome.exitCode, stderr: outcome.stderr, resolved }
  }))

Feature('Resolving a fixture bake against a pinned registry snapshot')
  .withLayer(PORTS)
  .live('npm resolves a pinned fixture manifest with the bake cutoff against a local registry')
  .body(({ scenario }) => {
    scenario(
      'Releases published after the cutoff never enter the resolution',
      Gherkin.Do.pipe(
        Given('a registry where effect, @effect/platform-node and left-pad each published after the cutoff')(
          'registry',
          () => Effect.succeed(REGISTRY),
        ),
        When('npm resolves the fixture with the pins of a root lockfile that resolves effect 4.0.0')(
          'outcome',
          (s) => resolveFixture(s.registry),
        ),
        Then('the fixture resolves the root lockfile versions of the effect family and pre-cutoff left-pad')(
          (s, expect) =>
            expect({ exitCode: s.outcome.exitCode, resolved: s.outcome.resolved }).toStrictEqual({
              exitCode: 0,
              resolved: {
                '@effect/platform-node': '4.0.0',
                effect: '4.0.0',
                'left-pad': '1.0.0',
                'packed-cli': '1.0.0',
              },
            }),
        ),
      ),
    )
  })
