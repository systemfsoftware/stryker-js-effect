import { NodeFileSystem, NodePath } from '@effect/platform-node'
import * as NodeChildProcessSpawner from '@effect/platform-node/NodeChildProcessSpawner'
import * as NodeHttpServer from '@effect/platform-node/NodeHttpServer'
import { Gherkin, Given, it, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as Layer from 'effect/Layer'
import * as Option from 'effect/Option'
import * as Path from 'effect/Path'
import * as S from 'effect/Schema'

import { NpmManifestJson, type PackedManifest, packedMemberOf, tarballFileOf } from '@systemfsoftware/stryker-e2e-core'
import {
  checkFixtureLock,
  driftLinesOf,
  type FixtureSource,
  type LockContext,
  lockFixture,
  packsDirOf,
  runCommand,
} from './__fixtures__/fixture-locks.js'
import { type Registry, serveRegistry } from './__fixtures__/local-registry.js'

const Feature = makeFeature({ it })

const FILE_AND_PATH = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer)

const PORTS = Layer.mergeAll(
  FILE_AND_PATH,
  NodeChildProcessSpawner.layer.pipe(Layer.provide(FILE_AND_PATH)),
  Layer.orDie(NodeHttpServer.layerTest),
)

const PUBLISHED = '2026-10-01T03:11:28.537Z'

const REGISTRY: Registry = {
  effect: [{ version: '4.0.0', time: PUBLISHED }, { version: '4.0.1', time: PUBLISHED }],
  'left-pad': [{ version: '1.0.0', time: PUBLISHED }, { version: '2.0.0', time: PUBLISHED }],
}

const CLI = '@scratch/cli'
const RUNNER = '@scratch/runner'
const FIXTURE_ID = 'scratch-fixture'

interface World {
  readonly members: ReadonlyArray<PackedManifest>
  readonly devDependencies: Readonly<Record<string, string>>
  readonly effectPin: string
}

const BASELINE: World = {
  members: [
    { name: CLI, version: '1.0.0', dependencies: { [RUNNER]: '^1.0.0' } },
    { name: RUNNER, version: '1.0.0' },
  ],
  devDependencies: {},
  effectPin: '4.0.0',
}

const pnpmLockfileOf = (effectPin: string): string =>
  [
    "lockfileVersion: '9.0'",
    '',
    'packages:',
    '',
    `  effect@${effectPin}:`,
    '    resolution: {integrity: sha512-pinned}',
    '',
  ].join('\n')

const packScratchMember = (root: string, packs: string, manifest: PackedManifest) =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const source = path.join(root, 'sources', `${manifest.name}@${manifest.version}`)
    yield* fs.makeDirectory(source, { recursive: true })
    yield* fs.writeFileString(
      path.join(source, 'package.json'),
      yield* S.encodeEffect(NpmManifestJson)({
        name: manifest.name,
        version: manifest.version,
        dependencies: { ...manifest.dependencies },
      }),
    )
    const packed = yield* runCommand({ argv: ['npm', 'pack', '--pack-destination', packs], cwd: source })
    const fileName = packed.stdout.trim().split('\n').at(-1) ?? ''
    yield* fs.rename(path.join(packs, fileName), path.join(packs, tarballFileOf(manifest.name)))
    return packedMemberOf(manifest)
  })

const contextOf = (root: string, label: string, registry: string, world: World) =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const stagingRoot = path.join(root, label)
    const packs = packsDirOf(stagingRoot)
    yield* fs.makeDirectory(packs, { recursive: true })
    const members = yield* Effect.forEach(world.members, (manifest) => packScratchMember(root, packs, manifest))
    return {
      stagingRoot,
      members,
      workspace: world.members.map((manifest) => manifest.name),
      pnpmLockfile: pnpmLockfileOf(world.effectPin),
      workspaceYaml: '',
      npmArgs: [`--registry=${registry}`, `--cache=${path.join(root, 'npm-cache')}`],
    } satisfies LockContext
  })

const writeFixture = (fixture: FixtureSource, world: World) =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    yield* fs.makeDirectory(fixture.dir, { recursive: true })
    const manifest = yield* S.encodeEffect(NpmManifestJson)({
      name: FIXTURE_ID,
      version: '0.0.0',
      private: true,
      devDependencies: world.devDependencies,
    })
    yield* fs.writeFileString(path.join(fixture.dir, 'package.json'), `${manifest}\n`)
  })

interface CheckOptions {
  readonly lock: boolean
  readonly ci: boolean
}

const installedVersionOf = (stagedDir: string) => (name: string) =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const installed = yield* Effect.option(Effect.flatMap(
      fs.readFileString(path.join(stagedDir, 'node_modules', name, 'package.json')),
      S.decodeEffect(NpmManifestJson),
    ))
    return [name, Option.getOrNull(Option.map(installed, (manifest) => manifest.version))] as const
  })

const npmCiOf = (stagedDir: string, root: string) =>
  Effect.gen(function*() {
    const path = yield* Path.Path
    const ci = yield* runCommand({
      argv: [
        'npm',
        'ci',
        '--offline',
        '--ignore-scripts',
        '--no-audit',
        '--no-fund',
        `--cache=${path.join(root, 'ci-cache')}`,
      ],
      cwd: stagedDir,
    })
    return {
      exitCode: ci.exitCode,
      refusedAsOutOfSync: ci.stderr.includes('EUSAGE'),
      resolvesLeftPadItself: /request to \S+\/left-pad failed/.test(ci.stderr),
      installed: Object.fromEntries(yield* Effect.forEach([CLI, RUNNER], installedVersionOf(stagedDir))),
    }
  })

const lockThenCheck = (before: World, after: World, options: CheckOptions) =>
  Effect.scoped(Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const root = yield* fs.makeTempDirectoryScoped({ prefix: 'fixture-locks-' })
    const registry = yield* serveRegistry(REGISTRY)
    const fixture: FixtureSource = { fixtureId: FIXTURE_ID, dir: path.join(root, 'resources', FIXTURE_ID) }
    yield* writeFixture(fixture, before)
    yield* options.lock
      ? lockFixture({ context: yield* contextOf(root, 'before', registry, before), fixture })
      : Effect.void
    yield* writeFixture(fixture, after)
    const report = yield* checkFixtureLock({ context: yield* contextOf(root, 'after', registry, after), fixture })
    const installed = options.ci ? yield* npmCiOf(path.join(root, 'after', 'baked', FIXTURE_ID), root) : null
    return { drift: driftLinesOf(report).join('\n'), installed }
  }))

const withMembers = (world: World, members: ReadonlyArray<PackedManifest>): World => ({ ...world, members })

const runnerWith = (manifest: Partial<PackedManifest>): ReadonlyArray<PackedManifest> => [
  BASELINE.members[0],
  { name: RUNNER, version: '1.0.0', ...manifest },
]

Feature('Detecting a stale fixture lock')
  .withLayer(PORTS)
  .live('a generated fixture lock is checked offline against a changed closure, manifest or pin')
  .body(({ scenario }) => {
    scenario(
      'A release that only bumps closure versions keeps the lock valid, and npm ci installs the released closure from it',
      Gherkin.Do.pipe(
        Given('a lock generated for closure version 1.0.0, where the CLI depends on the runner ^1.0.0')(
          'before',
          () => Effect.succeed(BASELINE),
        ),
        When('every closure member is released as 1.0.1')(
          'checked',
          (s) =>
            lockThenCheck(s.before, withMembers(s.before, s.before.members.map((m) => ({ ...m, version: '1.0.1' }))), {
              lock: true,
              ci: true,
            }),
        ),
        Then('the check reports nothing, and npm ci installs both members at 1.0.1 offline')((s, expect) =>
          expect({
            drift: s.checked.drift,
            exitCode: s.checked.installed?.exitCode,
            installed: s.checked.installed?.installed,
          }).toStrictEqual({ drift: '', exitCode: 0, installed: { [CLI]: '1.0.1', [RUNNER]: '1.0.1' } })
        ),
      ),
    )

    scenario(
      'A closure member that gains a registry dependency fails the check, while npm ci would resolve it at install time',
      Gherkin.Do.pipe(
        Given('a lock generated for a runner with no dependencies')('before', () => Effect.succeed(BASELINE)),
        When('the runner starts depending on left-pad')(
          'checked',
          (s) =>
            lockThenCheck(s.before, withMembers(s.before, runnerWith({ dependencies: { 'left-pad': '^1.0.0' } })), {
              lock: true,
              ci: true,
            }),
        ),
        Then('npm ls names the missing dependency, and npm ci reaches for the registry instead of refusing the lock')((
          s,
          expect,
        ) =>
          expect({
            drift: s.checked.drift.includes(`E2E_PINS_DRIFT: ${FIXTURE_ID}: missing: left-pad@^1.0.0`),
            ci: {
              refusedAsOutOfSync: s.checked.installed?.refusedAsOutOfSync,
              resolvesLeftPadItself: s.checked.installed?.resolvesLeftPadItself,
            },
          }).toStrictEqual({ drift: true, ci: { refusedAsOutOfSync: false, resolvesLeftPadItself: true } })
        ),
      ),
    )

    scenario(
      'A closure member whose range moves past the locked version fails the check',
      Gherkin.Do.pipe(
        Given('a lock generated for a runner on left-pad ^1.0.0')(
          'before',
          () => Effect.succeed(withMembers(BASELINE, runnerWith({ dependencies: { 'left-pad': '^1.0.0' } }))),
        ),
        When('the runner moves to left-pad ^2.0.0')(
          'checked',
          (s) =>
            lockThenCheck(s.before, withMembers(s.before, runnerWith({ dependencies: { 'left-pad': '^2.0.0' } })), {
              lock: true,
              ci: false,
            }),
        ),
        Then('npm ls reports the locked left-pad as invalid')((s, expect) =>
          expect(s.checked.drift).toMatch(/E2E_PINS_DRIFT: scratch-fixture: invalid: left-pad@1\.0\.0/)
        ),
      ),
    )

    scenario(
      'A pnpm-lock.yaml pin that moves fails the check, naming both versions',
      Gherkin.Do.pipe(
        Given('a lock generated for a fixture on effect, pinned at 4.0.0')(
          'before',
          () => Effect.succeed({ ...BASELINE, devDependencies: { effect: '^4.0.0' } }),
        ),
        When('pnpm-lock.yaml moves effect to 4.0.1')(
          'checked',
          (s) => lockThenCheck(s.before, { ...s.before, effectPin: '4.0.1' }, { lock: true, ci: false }),
        ),
        Then('the check reports the moved pin')((s, expect) =>
          expect(s.checked.drift).toContain(
            `E2E_PINS_DRIFT: ${FIXTURE_ID}: effect: pnpm-lock.yaml pins 4.0.1, the lock has 4.0.0.`,
          )
        ),
      ),
    )

    scenario(
      'A fixture manifest that gains a dependency fails the check',
      Gherkin.Do.pipe(
        Given('a lock generated for a fixture with no registry dependency')('before', () => Effect.succeed(BASELINE)),
        When('the fixture starts depending on left-pad')(
          'checked',
          (s) =>
            lockThenCheck(s.before, { ...s.before, devDependencies: { 'left-pad': '^1.0.0' } }, {
              lock: true,
              ci: false,
            }),
        ),
        Then('the check names left-pad in the root manifest')((s, expect) =>
          expect(s.checked.drift).toContain(
            `E2E_PINS_DRIFT: ${FIXTURE_ID}: left-pad: the root manifest differs from the lock.`,
          )
        ),
      ),
    )

    scenario(
      'A closure that gains a member fails the check, naming the member',
      Gherkin.Do.pipe(
        Given('a lock generated for a closure without the checker')('before', () => Effect.succeed(BASELINE)),
        When('the closure packs a checker too')('checked', (s) =>
          lockThenCheck(
            s.before,
            withMembers(s.before, [...s.before.members, { name: '@scratch/checker', version: '1.0.0' }]),
            { lock: true, ci: false },
          )),
        Then('the check reports the checker missing from the lock')((s, expect) =>
          expect(s.checked.drift).toContain(
            `E2E_PINS_DRIFT: ${FIXTURE_ID}: @scratch/checker: closure member missing from the lock.`,
          )
        ),
      ),
    )

    scenario(
      'A closure that loses a member fails the check, naming the member',
      Gherkin.Do.pipe(
        Given('a lock generated for a closure with a checker')(
          'before',
          () =>
            Effect.succeed(
              withMembers(BASELINE, [...BASELINE.members, { name: '@scratch/checker', version: '1.0.0' }]),
            ),
        ),
        When('the closure stops packing the checker')(
          'checked',
          (s) => lockThenCheck(s.before, BASELINE, { lock: true, ci: false }),
        ),
        Then('the check reports the checker as no longer packed')((s, expect) =>
          expect(s.checked.drift).toContain(
            `E2E_PINS_DRIFT: ${FIXTURE_ID}: @scratch/checker: the lock names a package the closure no longer packs.`,
          )
        ),
      ),
    )

    scenario(
      'A fixture without a committed lock fails the check',
      Gherkin.Do.pipe(
        Given('a fixture that was never locked')('before', () => Effect.succeed(BASELINE)),
        When('the check runs')('checked', (s) => lockThenCheck(s.before, s.before, { lock: false, ci: false })),
        Then('the check reports the missing lock and its next action')((s, expect) =>
          expect(s.checked.drift).toBe(
            `E2E_PINS_DRIFT: ${FIXTURE_ID}: the fixture has no package-lock.json. Next: pnpm --filter @systemfsoftware/stryker-e2e-core fixtures:lock, then commit test/e2e/testResources/${FIXTURE_ID}/package-lock.json`,
          )
        ),
      ),
    )
  })
