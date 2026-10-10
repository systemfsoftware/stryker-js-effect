import { NodeFileSystem, NodePath } from '@effect/platform-node'
import * as NodeChildProcessSpawner from '@effect/platform-node/NodeChildProcessSpawner'
import * as NodeHttpServer from '@effect/platform-node/NodeHttpServer'
import { Gherkin, Given, it, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as Layer from 'effect/Layer'
import * as Option from 'effect/Option'
import * as Path from 'effect/Path'
import { ChildProcess, ChildProcessSpawner } from 'effect/process'
import * as S from 'effect/Schema'
import * as Stream from 'effect/Stream'

import {
  BakeFailed,
  bakeReasonsOf,
  bakeReportOf,
  type NpmLockfile,
  NpmLockfileJson,
  PinnedFixtureManifestJson,
} from '@systemfsoftware/stryker-e2e-core'
import { InstalledPackageJson } from './__fixtures__/installed-package.schema.js'
import { type Registry, serveLateRegistry, serveRegistry } from './__fixtures__/local-registry.js'

const Feature = makeFeature({ it })

const FILE_AND_PATH = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer)

const PORTS = Layer.mergeAll(
  FILE_AND_PATH,
  NodeChildProcessSpawner.layer.pipe(Layer.provide(FILE_AND_PATH)),
  Layer.orDie(NodeHttpServer.layerTest),
)

const FIXTURE_ID = 'calc-fixture'
const DEADLINE_SECONDS = 2
const PUBLISHED = '2026-10-01T03:11:28.537Z'
const RUNNER_TARBALL = 'scratch-runner.tgz'
const SERVED_LOCALLY = 'served by the test registry'

type Specs = Readonly<Record<string, string>>

interface Fixture {
  readonly devDependencies: Specs
  readonly locked: NpmLockfile['packages']
}

const lockOf = (fixture: Fixture): NpmLockfile => ({
  name: FIXTURE_ID,
  version: '0.0.0',
  lockfileVersion: 3,
  requires: true,
  packages: {
    '': { name: FIXTURE_ID, version: '0.0.0', devDependencies: fixture.devDependencies },
    ...fixture.locked,
  },
})

const LEFT_PAD_LOCKED: Fixture = {
  devDependencies: { 'left-pad': '^1.0.0' },
  locked: {
    'node_modules/left-pad': {
      version: '1.0.0',
      resolved: 'https://registry.npmjs.org/left-pad/-/left-pad-1.0.0.tgz',
      dev: true,
    },
  },
}

const RUNNER_LOCKED: Fixture = {
  devDependencies: { '@scratch/runner': `file:../../packs/${RUNNER_TARBALL}` },
  locked: { 'node_modules/@scratch/runner': { resolved: `file:../../packs/${RUNNER_TARBALL}`, dev: true } },
}

const run = (argv: ReadonlyArray<string>, cwd: string, env: Specs) =>
  Effect.scoped(Effect.gen(function*() {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
    const [command, ...args] = argv
    const handle = yield* spawner.spawn(ChildProcess.make(command, args, { cwd, extendEnv: true, env }))
    const [stdout, stderr, exitCode] = yield* Effect.all(
      [
        handle.stdout.pipe(Stream.decodeText, Stream.mkString),
        handle.stderr.pipe(Stream.decodeText, Stream.mkString),
        handle.exitCode,
      ],
      { concurrency: 'unbounded' },
    )
    return { exitCode, stdout, stderr }
  }))

const packedLeftPad = (version: string) =>
  Effect.scoped(Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const source = yield* fs.makeTempDirectoryScoped({ prefix: 'left-pad-' })
    yield* fs.writeFileString(
      path.join(source, 'package.json'),
      yield* S.encodeEffect(InstalledPackageJson)({ name: 'left-pad', version, description: SERVED_LOCALLY }),
    )
    const packed = yield* run(['npm', 'pack', '--pack-destination', source], source, {})
    return yield* fs.readFile(path.join(source, packed.stdout.trim().split('\n').at(-1) ?? ''))
  }))

const leftPadRegistry = Effect.gen(function*() {
  const published: Registry = {
    'left-pad': [
      { version: '1.0.0', time: PUBLISHED, tarball: yield* packedLeftPad('1.0.0') },
      { version: '1.1.0', time: PUBLISHED, tarball: yield* packedLeftPad('1.1.0') },
    ],
  }
  return yield* serveRegistry(published)
})

const bakeArgv = (root: string): ReadonlyArray<string> => [
  `--root=${root}`,
  `--deadline=${DEADLINE_SECONDS}`,
  '--lanes=4',
]

interface BakeRun {
  readonly fixture: Fixture
  readonly registry: string
  readonly argv: (root: string) => ReadonlyArray<string>
}

const runBake = (bake: BakeRun) =>
  Effect.scoped(Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const script = path.join(import.meta.dirname, '..', 'bake', 'bake-fixtures.sh')
    const scratch = yield* fs.makeTempDirectoryScoped({ prefix: 'bake-fixtures-' })
    const root = path.join(scratch, 'baked')
    const fixture = path.join(root, FIXTURE_ID)
    yield* fs.makeDirectory(fixture, { recursive: true })
    yield* fs.writeFileString(
      path.join(fixture, 'package.json'),
      yield* S.encodeEffect(PinnedFixtureManifestJson)({
        name: FIXTURE_ID,
        version: '0.0.0',
        private: true,
        devDependencies: bake.fixture.devDependencies,
      }),
    )
    yield* fs.writeFileString(
      path.join(fixture, 'package-lock.json'),
      yield* S.encodeEffect(NpmLockfileJson)(lockOf(bake.fixture)),
    )
    const outcome = yield* run(['sh', script, ...bake.argv(root)], scratch, {
      npm_config_registry: bake.registry,
      npm_config_cache: path.join(scratch, 'npm-cache'),
      npm_config_userconfig: path.join(scratch, 'npmrc'),
      npm_config_fetch_retries: '0',
    })
    const installed = yield* Effect.option(Effect.flatMap(
      fs.readFileString(path.join(fixture, 'node_modules', 'left-pad', 'package.json')),
      S.decodeEffect(InstalledPackageJson),
    ))
    const reasons = bakeReasonsOf({ stderrTail: outcome.stderr, exitCode: outcome.exitCode })
    return {
      exitCode: outcome.exitCode,
      stderr: outcome.stderr,
      reasons,
      codes: reasons.map((reason) => reason.code),
      installed: Option.getOrNull(installed),
    }
  }))

Feature('Baking fixtures from their committed locks with bake-fixtures.sh')
  .withLayer(PORTS)
  .live('the bake runs npm ci per fixture and names why a bake failed in a line the harness parses')
  .body(({ scenario }) => {
    scenario(
      'A locked fixture installs the locked version while the registry also serves a newer release',
      Gherkin.Do.pipe(
        Given('a registry serving left-pad 1.0.0 and 1.1.0')('registry', () => leftPadRegistry),
        When('the bake installs a fixture whose lock records left-pad 1.0.0 under ^1.0.0')(
          'outcome',
          (s) => runBake({ fixture: LEFT_PAD_LOCKED, registry: s.registry, argv: bakeArgv }),
        ),
        Then('the bake exits 0 and the fixture holds left-pad 1.0.0')((s, expect) =>
          expect({ exitCode: s.outcome.exitCode, installed: s.outcome.installed }).toStrictEqual({
            exitCode: 0,
            installed: { name: 'left-pad', version: '1.0.0', description: SERVED_LOCALLY },
          })
        ),
      ),
    )
    scenario(
      'An install that outlives its deadline is reported as stalled, and the report annotates it',
      Gherkin.Do.pipe(
        Given('a registry that answers only after the install deadline has passed')(
          'registry',
          () => serveLateRegistry(`${DEADLINE_SECONDS + 3} seconds`),
        ),
        When('the bake installs the locked fixture with a two-second deadline')(
          'outcome',
          (s) => runBake({ fixture: LEFT_PAD_LOCKED, registry: s.registry, argv: bakeArgv }),
        ),
        When('the harness renders the failed bake')(
          'report',
          (s) => Effect.succeed(bakeReportOf(BakeFailed.make({ reasons: s.outcome.reasons, seconds: 3 }))),
        ),
        Then('the bake fails with E2E_BAKE_STALLED naming the fixture and its deadline, in summary and annotation')(
          (s, expect) =>
            expect({
              failed: s.outcome.exitCode !== 0,
              codes: s.outcome.codes,
              namesFixtureAndDeadline: s.outcome.stderr.includes(
                `E2E_BAKE_STALLED: ${FIXTURE_ID}: npm ci did not finish within ${DEADLINE_SECONDS}s`,
              ),
              summarized: s.report.summary.includes('`E2E_BAKE_STALLED`'),
              annotated: s.report.annotations.map((line) => line.startsWith('::error title=E2E_BAKE_STALLED::')),
            }).toStrictEqual({
              failed: true,
              codes: ['E2E_BAKE_STALLED'],
              namesFixtureAndDeadline: true,
              summarized: true,
              annotated: [true],
            }),
        ),
      ),
    )
    scenario(
      'A lock naming a closure tarball the harness did not pack is reported as a missing tarball',
      Gherkin.Do.pipe(
        Given('a registry serving left-pad')('registry', () => leftPadRegistry),
        When('the bake installs a fixture whose lock names ../../packs/scratch-runner.tgz, which is absent')(
          'outcome',
          (s) => runBake({ fixture: RUNNER_LOCKED, registry: s.registry, argv: bakeArgv }),
        ),
        Then('the bake fails with E2E_BAKE_TARBALL_MISSING naming scratch-runner.tgz')((s, expect) =>
          expect({
            failed: s.outcome.exitCode !== 0,
            codes: s.outcome.codes,
            namesTarball: s.outcome.stderr.includes(
              `E2E_BAKE_TARBALL_MISSING: ${FIXTURE_ID}: npm ci found no closure tarball ${RUNNER_TARBALL}`,
            ),
          }).toStrictEqual({ failed: true, codes: ['E2E_BAKE_TARBALL_MISSING'], namesTarball: true })
        ),
      ),
    )
    scenario(
      'A call without the install deadline is refused before any install',
      Gherkin.Do.pipe(
        Given('a registry serving left-pad')('registry', () => leftPadRegistry),
        When('the bake is called with --lanes where --deadline belongs')(
          'outcome',
          (s) =>
            runBake({
              fixture: LEFT_PAD_LOCKED,
              registry: s.registry,
              argv: (root) => [`--root=${root}`, '--lanes=4'],
            }),
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
