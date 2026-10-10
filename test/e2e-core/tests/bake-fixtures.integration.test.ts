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

import { bakeReasonsOf, REGISTRY_CUTOFF } from '@systemfsoftware/stryker-e2e-core'
import { serveLateRegistry, serveRegistry } from './__fixtures__/local-registry.js'
import { PinnedFixtureManifestJson } from './__fixtures__/npm-closure.schema.js'

const Feature = makeFeature({ it })

const FILE_AND_PATH = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer)

const PORTS = Layer.mergeAll(
  FILE_AND_PATH,
  NodeChildProcessSpawner.layer.pipe(Layer.provide(FILE_AND_PATH)),
  Layer.orDie(NodeHttpServer.layerTest),
)

const AFTER_CUTOFF = '2026-10-10T10:04:06.183Z'

const STALE_REGISTRY = { 'left-pad': [{ version: '1.1.0', time: AFTER_CUTOFF }] }

const FIXTURE_ID = 'calc-fixture'

const FIXTURE_MANIFEST = {
  name: FIXTURE_ID,
  version: '0.0.0',
  private: true,
  devDependencies: { 'left-pad': '^1.1.0' },
}

const DEADLINE_SECONDS = 2

interface BakeRun {
  readonly argv: ReadonlyArray<string>
  readonly registry: string
}

const bakeArgv = (root: string): ReadonlyArray<string> => [
  `--before=${REGISTRY_CUTOFF}`,
  `--root=${root}`,
  `--deadline=${DEADLINE_SECONDS}`,
  '--lanes=4',
]

const runBake = (run: BakeRun) =>
  Effect.scoped(Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
    const script = path.join(import.meta.dirname, '..', 'bake', 'bake-fixtures.sh')
    const scratch = yield* fs.makeTempDirectoryScoped({ prefix: 'bake-fixtures-' })
    const fixture = path.join(scratch, 'baked', FIXTURE_ID)
    yield* fs.makeDirectory(fixture, { recursive: true })
    yield* fs.writeFileString(
      path.join(fixture, 'package.json'),
      yield* S.encodeEffect(PinnedFixtureManifestJson)(FIXTURE_MANIFEST),
    )
    const argv = run.argv.map((arg) => arg.replace('<root>', path.join(scratch, 'baked')))
    const handle = yield* spawner.spawn(ChildProcess.make('sh', [script, ...argv], {
      cwd: scratch,
      extendEnv: true,
      env: {
        npm_config_registry: run.registry,
        npm_config_cache: path.join(scratch, 'npm-cache'),
        npm_config_userconfig: path.join(scratch, 'npmrc'),
        npm_config_fetch_retries: '0',
      },
    }))
    const [stderr, exitCode] = yield* Effect.all(
      [handle.stderr.pipe(Stream.decodeText, Stream.mkString), handle.exitCode],
      { concurrency: 'unbounded' },
    )
    return { exitCode, codes: bakeReasonsOf({ stderrTail: stderr, exitCode }).map((reason) => reason.code), stderr }
  }))

Feature('Baking fixtures with bake-fixtures.sh against a registry snapshot')
  .withLayer(PORTS)
  .live('the bake script names why a bake failed in a line the harness parses into a reason code')
  .body(({ scenario }) => {
    scenario(
      'A package published only after the cutoff is reported as a stale cutoff, naming the package',
      Gherkin.Do.pipe(
        Given('a registry whose only left-pad release is newer than the registry cutoff')(
          'registry',
          () => serveRegistry(STALE_REGISTRY),
        ),
        When('the bake installs a fixture that depends on left-pad ^1.1.0')(
          'outcome',
          (s) => runBake({ argv: bakeArgv('<root>'), registry: s.registry }),
        ),
        Then('the bake fails with E2E_BAKE_CUTOFF_STALE naming left-pad')((s, expect) =>
          expect({
            failed: s.outcome.exitCode !== 0,
            codes: s.outcome.codes,
            namesSpec: s.outcome.stderr.includes(
              `E2E_BAKE_CUTOFF_STALE: ${FIXTURE_ID}: npm found no left-pad published`,
            ),
          }).toStrictEqual({ failed: true, codes: ['E2E_BAKE_CUTOFF_STALE'], namesSpec: true })
        ),
      ),
    )
    scenario(
      'An install that outlives its deadline is reported as stalled, with its deadline',
      Gherkin.Do.pipe(
        Given('a registry that answers only after the install deadline has passed')(
          'registry',
          () => serveLateRegistry(`${DEADLINE_SECONDS + 3} seconds`),
        ),
        When('the bake installs a fixture with a two-second install deadline')(
          'outcome',
          (s) => runBake({ argv: bakeArgv('<root>'), registry: s.registry }),
        ),
        Then('the bake fails with E2E_BAKE_STALLED saying the install did not finish within 2s')((s, expect) =>
          expect({
            failed: s.outcome.exitCode !== 0,
            codes: s.outcome.codes,
            saysDeadline: s.outcome.stderr.includes(`did not finish within ${DEADLINE_SECONDS}s`),
          }).toStrictEqual({ failed: true, codes: ['E2E_BAKE_STALLED'], saysDeadline: true })
        ),
      ),
    )
    scenario(
      'A call without the registry cutoff is refused before any install',
      Gherkin.Do.pipe(
        Given('a registry that serves the fixture dependency')('registry', () => serveRegistry(STALE_REGISTRY)),
        When('the bake is called with a tarball where --before belongs')(
          'outcome',
          (s) => runBake({ argv: ['x.tgz', ...bakeArgv('<root>').slice(1)], registry: s.registry }),
        ),
        Then('the bake exits 2 with E2E_BAKE_ARGV and installs nothing')((s, expect) =>
          expect({
            exitCode: s.outcome.exitCode,
            codes: s.outcome.codes,
            installed: s.outcome.stderr.includes('[bake]'),
          }).toStrictEqual({ exitCode: 2, codes: ['E2E_BAKE_ARGV'], installed: false })
        ),
      ),
    )
  })
