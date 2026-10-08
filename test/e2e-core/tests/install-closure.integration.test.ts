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

const WORKSPACE = [CLI, RUNNER, PLUGIN_INTERFACE, CHECKER]

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

const refusalOf = (members: ReadonlyArray<PackedMember>, fixtures: ReadonlyArray<StagedFixtureManifest>) =>
  Effect.gen(function*() {
    const planned = installClosure(InstallClosureCommand.make({ members, fixtures, workspace: WORKSPACE }))
    return Result.isFailure(planned) ? yield* S.encodeEffect(InstallClosureFailure)(planned.failure) : null
  })

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

const installOffline = (manifests: ReadonlyArray<PackedManifest>) =>
  Effect.scoped(Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const root = yield* fs.makeTempDirectoryScoped({ prefix: 'install-closure-' })
    const members = yield* Effect.forEach(manifests, (manifest) => packMember(root, manifest))
    const install = yield* Effect.fromResult(
      installClosure(InstallClosureCommand.make({ members, fixtures: [], workspace: WORKSPACE })),
    )
    const fixture = path.join(root, 'fixture')
    yield* fs.makeDirectory(fixture)
    const fixtureJson = yield* S.encodeEffect(NpmManifestJson)({ name: 'fixture', version: '0.0.0', private: true })
    yield* fs.writeFileString(path.join(fixture, 'package.json'), fixtureJson)
    const outcome = yield* runCommand(
      [
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
        ...install.specs,
      ],
      fixture,
    )
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
        When('npm installs the planned closure')('installed', (s) => installOffline(s.closure)),
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
              {
                path: 'calc-fixture/package.json',
                manifest: { devDependencies: { [CLI]: `^${VERSION_ABSENT_FROM_THE_REGISTRY}` } },
              },
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
  })
