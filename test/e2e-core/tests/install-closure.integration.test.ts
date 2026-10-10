import { NodeFileSystem, NodePath } from '@effect/platform-node'
import * as NodeChildProcessSpawner from '@effect/platform-node/NodeChildProcessSpawner'
import { Gherkin, Given, it, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as Layer from 'effect/Layer'
import * as Path from 'effect/Path'
import { ChildProcess, ChildProcessSpawner } from 'effect/process'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import * as Stream from 'effect/Stream'

import {
  type FixtureManifest,
  installClosure,
  InstallClosureCommand,
  InstallClosureFailure,
  type PackedManifest,
  type PackedMember,
  type StagedFixtureManifest,
} from '@systemfsoftware/stryker-e2e-core'
import { type NpmLockfile, NpmLockfileJson, NpmManifestJson } from './__fixtures__/npm-closure.schema.js'

const Feature = makeFeature({ it })

const FILE_AND_PATH = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer)

const PORTS = Layer.mergeAll(FILE_AND_PATH, NodeChildProcessSpawner.layer.pipe(Layer.provide(FILE_AND_PATH)))

const CLI = '@systemfsoftware/stryker-js'
const RUNNER = '@systemfsoftware/stryker-js-vitest-runner'
const RUNNER_ALIAS = '@systemfsoftware/stryker-js-vm-runner'
const PLUGIN_INTERFACE = '@systemfsoftware/stryker-js-plugin-interface'
const CHECKER = '@systemfsoftware/stryker-js-typescript-checker'
const S3_STORE = '@systemfsoftware/stryker-js-verdict-store-s3'

const WORKSPACE = [CLI, RUNNER, PLUGIN_INTERFACE, CHECKER, S3_STORE]

const ON_REQUEST = [S3_STORE]

const VERSION_ABSENT_FROM_THE_REGISTRY = '9999.0.0'

const manifestOf = (name: string, dependencies: Record<string, string>): PackedManifest => ({
  name,
  dependencies,
})

const CLOSURE: ReadonlyArray<PackedManifest> = [
  manifestOf(CLI, {
    [RUNNER_ALIAS]: `npm:${RUNNER}@^${VERSION_ABSENT_FROM_THE_REGISTRY}`,
    [PLUGIN_INTERFACE]: `^${VERSION_ABSENT_FROM_THE_REGISTRY}`,
  }),
  manifestOf(RUNNER, {}),
  manifestOf(PLUGIN_INTERFACE, {}),
]

const memberOf = (manifest: PackedManifest): PackedMember => ({ tarballPath: `/packs/${manifest.name}.tgz`, manifest })

const stagedOf = (fixture: string, manifest: FixtureManifest): StagedFixtureManifest => ({
  fixture,
  path: `${fixture}/package.json`,
  manifest,
})

const REQUESTS_S3_STORE: FixtureManifest = {
  peerDependencies: { [S3_STORE]: '*' },
  peerDependenciesMeta: { [S3_STORE]: { optional: true } },
}

const commandOf = (members: ReadonlyArray<PackedMember>, fixtures: ReadonlyArray<StagedFixtureManifest>) =>
  InstallClosureCommand.make({ members, fixtures, workspace: WORKSPACE, onRequest: ON_REQUEST })

const refusalOf = (members: ReadonlyArray<PackedMember>, fixtures: ReadonlyArray<StagedFixtureManifest>) =>
  Effect.gen(function*() {
    const planned = installClosure(commandOf(members, fixtures))
    return Result.isFailure(planned) ? yield* S.encodeEffect(InstallClosureFailure)(planned.failure) : null
  })

const plannedSpecsOf = (members: ReadonlyArray<PackedMember>, fixtures: ReadonlyArray<StagedFixtureManifest>) =>
  Effect.map(
    Effect.fromResult(installClosure(commandOf(members, fixtures))),
    (install) => Object.fromEntries(install.fixtures.map((planned) => [planned.fixture, planned.specs])),
  )

interface CommandOutcome {
  readonly exitCode: number
  readonly stdout: string
  readonly stderr: string
}

const runCommand = (argv: readonly [string, ...Array<string>], cwd: string) =>
  Effect.scoped(Effect.gen(function*() {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
    const [command, ...args] = argv
    const handle = yield* spawner.spawn(ChildProcess.make(command, args, { cwd }))
    const [stdout, stderr, exitCode] = yield* Effect.all(
      [
        handle.stdout.pipe(Stream.decodeText, Stream.runCollect),
        handle.stderr.pipe(Stream.decodeText, Stream.runCollect),
        handle.exitCode,
      ] as const,
      { concurrency: 'unbounded' },
    )
    return { exitCode, stdout: stdout.join(''), stderr: stderr.join('') } satisfies CommandOutcome
  }))

const packMember = (root: string, manifest: PackedManifest) =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const source = path.join(root, 'sources', manifest.name)
    const packs = path.join(root, 'packs')
    yield* fs.makeDirectory(source, { recursive: true })
    yield* fs.makeDirectory(packs, { recursive: true })
    const packageJson = yield* S.encodeEffect(NpmManifestJson)({
      name: manifest.name,
      version: VERSION_ABSENT_FROM_THE_REGISTRY,
      dependencies: { ...manifest.dependencies },
    })
    yield* fs.writeFileString(path.join(source, 'package.json'), packageJson)
    const packed = yield* runCommand(['npm', 'pack', '--pack-destination', packs], source)
    const fileName = packed.stdout.trim().split('\n').at(-1) ?? ''
    return { tarballPath: path.join(packs, fileName), manifest } satisfies PackedMember
  })

interface LockProvenance {
  readonly name: string
  readonly resolved: string
}

const provenanceOf = (lockfile: NpmLockfile): ReadonlyArray<LockProvenance> =>
  Object.entries(lockfile.packages)
    .filter(([location]) => location !== '')
    .map(([location, entry]) => ({
      name: entry.name ?? location.slice(location.lastIndexOf('node_modules/') + 'node_modules/'.length),
      resolved: entry.resolved ?? '',
    }))

interface InstallOutcome {
  readonly exitCode: number
  readonly stderr: string
  readonly provenance: ReadonlyArray<LockProvenance>
}

const installOffline = (manifests: ReadonlyArray<PackedManifest>, fixtureManifest: FixtureManifest) =>
  Effect.scoped(Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const root = yield* fs.makeTempDirectoryScoped({ prefix: 'install-closure-' })
    const members = yield* Effect.forEach(manifests, (manifest) => packMember(root, manifest))
    const install = yield* Effect.fromResult(
      installClosure(commandOf(members, [stagedOf('fixture', fixtureManifest)])),
    )
    const specs = install.fixtures.flatMap((planned) => planned.specs)
    const fixture = path.join(root, 'fixture')
    yield* fs.makeDirectory(fixture)
    const fixtureJson = yield* S.encodeEffect(NpmManifestJson)({
      name: 'fixture',
      version: '0.0.0',
      private: true,
      ...fixtureManifest,
    })
    yield* fs.writeFileString(path.join(fixture, 'package.json'), fixtureJson)
    const offline = [
      'npm',
      'install',
      '--package-lock-only',
      '--offline',
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
      `--cache=${path.join(root, 'npm-cache')}`,
      `--userconfig=${path.join(root, 'npmrc')}`,
      '--registry=http://127.0.0.1:9/',
    ] as const
    const registryStep = yield* runCommand(offline, fixture)
    const outcome = registryStep.exitCode === 0 ? yield* runCommand([...offline, ...specs], fixture) : registryStep
    const lock = yield* fs.readFileString(path.join(fixture, 'package-lock.json')).pipe(
      Effect.flatMap(S.decodeEffect(NpmLockfileJson)),
      Effect.map(provenanceOf),
      Effect.orElseSucceed((): ReadonlyArray<LockProvenance> => []),
    )
    return { exitCode: outcome.exitCode, stderr: outcome.stderr, provenance: lock } satisfies InstallOutcome
  }))

const registryResolvedWorkspacePackages = (outcome: InstallOutcome): ReadonlyArray<string> =>
  outcome.provenance
    .filter((entry) => WORKSPACE.includes(entry.name) && !entry.resolved.startsWith('file:'))
    .map((entry) => entry.name)

const workspaceProvenance = (outcome: InstallOutcome): ReadonlyArray<string> =>
  outcome.provenance
    .filter((entry) => WORKSPACE.includes(entry.name))
    .map((entry) => entry.name)
    .sort()

Feature('Installing the packed workspace closure')
  .withLayer(PORTS)
  .live('npm packs a closure and installs the planned specs offline with an empty cache and an unreachable registry')
  .body(({ scenario }) => {
    scenario(
      'A member that names a sibling through an npm alias installs that sibling from its packed tarball',
      Gherkin.Do.pipe(
        Given('a closure whose CLI names the runner through an npm alias and the plugin interface by name')(
          'closure',
          () => Effect.succeed(CLOSURE),
        ),
        When('npm installs the planned closure')('installed', (s) => installOffline(s.closure, {})),
        Then('every workspace package in the lockfile, the aliased runner included, resolves from a packed tarball')(
          (s, expect) =>
            expect({
              exitCode: s.installed.exitCode,
              stderr: s.installed.exitCode === 0 ? '' : s.installed.stderr,
              registryResolved: registryResolvedWorkspacePackages(s.installed),
              installed: workspaceProvenance(s.installed),
            }).toStrictEqual({
              exitCode: 0,
              stderr: '',
              registryResolved: [],
              installed: [CLI, PLUGIN_INTERFACE, RUNNER, RUNNER].sort(),
            }),
        ),
      ),
    )

    scenario(
      'A member that names a workspace package the closure did not pack refuses the install, naming the edge',
      Gherkin.Do.pipe(
        Given('the closure without the runner tarball')(
          'members',
          () => Effect.succeed(CLOSURE.filter((manifest) => manifest.name !== RUNNER).map(memberOf)),
        ),
        When('the closure install is planned')('refused', (s) => refusalOf(s.members, [])),
        Then('the plan names the CLI, its alias, and the unpacked runner')((s, expect) =>
          expect(s.refused).toStrictEqual({
            _tag: 'UnpackedWorkspaceDependency',
            dependent: CLI,
            dependency: RUNNER_ALIAS,
            target: RUNNER,
          })
        ),
      ),
    )

    scenario(
      'Two members that alias one name to different workspace packages refuse the install, naming both targets',
      Gherkin.Do.pipe(
        Given('a closure where the plugin interface aliases the runner name to the checker')(
          'members',
          () =>
            Effect.succeed([
              ...CLOSURE.filter((manifest) => manifest.name !== PLUGIN_INTERFACE),
              manifestOf(PLUGIN_INTERFACE, { [RUNNER_ALIAS]: `npm:${CHECKER}@^${VERSION_ABSENT_FROM_THE_REGISTRY}` }),
              manifestOf(CHECKER, {}),
            ].map(memberOf)),
        ),
        When('the closure install is planned')('refused', (s) => refusalOf(s.members, [])),
        Then('the plan names the alias and both packages it would install as')((s, expect) =>
          expect(s.refused).toStrictEqual({
            _tag: 'ConflictingAliasTargets',
            dependency: RUNNER_ALIAS,
            targets: [CHECKER, RUNNER].sort(),
          })
        ),
      ),
    )

    scenario(
      'A fixture that names a workspace package refuses the install, naming the fixture manifest',
      Gherkin.Do.pipe(
        Given('a fixture whose manifest names the CLI as a devDependency')(
          'fixtures',
          () =>
            Effect.succeed<ReadonlyArray<StagedFixtureManifest>>([
              stagedOf('calc-fixture', { devDependencies: { [CLI]: `^${VERSION_ABSENT_FROM_THE_REGISTRY}` } }),
            ]),
        ),
        When('the closure install is planned')('refused', (s) => refusalOf(CLOSURE.map(memberOf), s.fixtures)),
        Then('the plan names the fixture manifest and the workspace package')((s, expect) =>
          expect(s.refused).toStrictEqual({
            _tag: 'FixtureNamesWorkspacePackage',
            fixture: 'calc-fixture/package.json',
            dependency: CLI,
            target: CLI,
          })
        ),
      ),
    )

    scenario(
      'An optional peer on a workspace package the closure did not pack plans the install',
      Gherkin.Do.pipe(
        Given('a closure whose CLI declares the unpacked checker as an optional peer')('members', () =>
          Effect.succeed(
            [
              {
                ...manifestOf(CLI, {}),
                peerDependencies: { [CHECKER]: `^${VERSION_ABSENT_FROM_THE_REGISTRY}` },
                peerDependenciesMeta: { [CHECKER]: { optional: true } },
              },
              manifestOf(RUNNER, {}),
            ].map(memberOf),
          )),
        When('the closure install is planned')('refused', (s) => refusalOf(s.members, [])),
        Then('the plan is not refused, because npm never fetches an absent optional peer')((s, expect) =>
          expect(s.refused).toBeNull()
        ),
      ),
    )

    scenario(
      'A fixture that declares an on-request member an optional peer installs it from its packed tarball',
      Gherkin.Do.pipe(
        Given('a closure carrying the on-request S3 store and a fixture that declares it an optional peer')(
          'closure',
          () => Effect.succeed([...CLOSURE, manifestOf(S3_STORE, {})]),
        ),
        When('npm installs the fixture and then its planned closure')(
          'installed',
          (s) => installOffline(s.closure, REQUESTS_S3_STORE),
        ),
        Then('the registry step skips the optional peer and the closure step installs it from the tarball')(
          (s, expect) =>
            expect({
              exitCode: s.installed.exitCode,
              stderr: s.installed.exitCode === 0 ? '' : s.installed.stderr,
              registryResolved: registryResolvedWorkspacePackages(s.installed),
              installed: workspaceProvenance(s.installed),
            }).toStrictEqual({
              exitCode: 0,
              stderr: '',
              registryResolved: [],
              installed: [CLI, PLUGIN_INTERFACE, RUNNER, RUNNER, S3_STORE].sort(),
            }),
        ),
      ),
    )

    scenario(
      'An on-request member installs only into the fixtures that request it, unless a shared member depends on it',
      Gherkin.Do.pipe(
        Given('a requesting fixture and a plain fixture')(
          'fixtures',
          () => Effect.succeed([stagedOf('requesting', REQUESTS_S3_STORE), stagedOf('plain', {})]),
        ),
        When('the closure install is planned with and without a shared member depending on the S3 store')(
          'planned',
          (s) =>
            Effect.all({
              requestedOnly: plannedSpecsOf([...CLOSURE, manifestOf(S3_STORE, {})].map(memberOf), s.fixtures),
              sharedDependency: plannedSpecsOf(
                [
                  ...CLOSURE.filter((manifest) => manifest.name !== PLUGIN_INTERFACE),
                  manifestOf(PLUGIN_INTERFACE, { [S3_STORE]: `^${VERSION_ABSENT_FROM_THE_REGISTRY}` }),
                  manifestOf(S3_STORE, {}),
                ].map(memberOf),
                s.fixtures,
              ),
            }),
        ),
        Then('the S3 tarball reaches the requesting fixture alone, and every fixture once a shared member needs it')(
          (s, expect) =>
            expect({
              requestedOnly: {
                requesting: s.planned.requestedOnly['requesting']?.includes(`/packs/${S3_STORE}.tgz`),
                plain: s.planned.requestedOnly['plain']?.includes(`/packs/${S3_STORE}.tgz`),
              },
              sharedDependency: {
                requesting: s.planned.sharedDependency['requesting']?.includes(`/packs/${S3_STORE}.tgz`),
                plain: s.planned.sharedDependency['plain']?.includes(`/packs/${S3_STORE}.tgz`),
              },
            }).toStrictEqual({
              requestedOnly: { requesting: true, plain: false },
              sharedDependency: { requesting: true, plain: true },
            }),
        ),
      ),
    )
  })
