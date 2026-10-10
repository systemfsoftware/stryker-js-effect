import * as Arr from 'effect/Array'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Path from 'effect/Path'
import { ChildProcess, ChildProcessSpawner } from 'effect/process'
import * as S from 'effect/Schema'
import * as Stream from 'effect/Stream'

import {
  closureMembersOf,
  committableLockOf,
  findLockDrift,
  FindLockDriftCommand,
  type FixtureManifestDocument,
  type LockDrift,
  NpmLockfile,
  NpmLockfileJson,
  overlayOf,
  PackedManifest,
  type PackedMember,
  packedMemberOf,
  stagedFixtureOf,
  tarballFileOf,
  WorkspaceListingJson,
  WorkspaceManifest,
} from '@systemfsoftware/stryker-e2e-core'

type Argv = readonly [string, ...Array<string>]

interface CommandOutcome {
  readonly exitCode: number
  readonly stdout: string
  readonly stderr: string
}

export interface CommandInput {
  readonly argv: Argv
  readonly cwd: string
}

export const runCommand = ({ argv, cwd }: CommandInput) =>
  Effect.scoped(Effect.gen(function*() {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
    const [command, ...args] = argv
    const handle = yield* spawner.spawn(ChildProcess.make(command, args, { cwd }))
    const [stdout, stderr, exitCode] = yield* Effect.all(
      [
        handle.stdout.pipe(Stream.decodeText, Stream.mkString),
        handle.stderr.pipe(Stream.decodeText, Stream.mkString),
        handle.exitCode,
      ] as const,
      { concurrency: 'unbounded' },
    )
    return { exitCode, stdout, stderr } satisfies CommandOutcome
  }))

const runChecked = (argv: Argv, cwd: string) =>
  Effect.filterOrElse(
    runCommand({ argv, cwd }),
    (outcome) => outcome.exitCode === 0,
    (outcome) => Effect.die(new Error(`${argv.join(' ')} exited ${outcome.exitCode}: ${outcome.stderr}`)),
  )

export interface LockContext {
  readonly stagingRoot: string
  readonly members: ReadonlyArray<PackedMember>
  readonly workspace: ReadonlyArray<string>
  readonly pnpmLockfile: string
  readonly workspaceYaml: string
  readonly npmArgs: ReadonlyArray<string>
}

export interface FixtureSource {
  readonly fixtureId: string
  readonly dir: string
}

export interface FixtureLockReport {
  readonly fixtureId: string
  readonly findings: ReadonlyArray<LockDrift>
  readonly problems: ReadonlyArray<string>
}

const MANIFEST_FILE = 'package.json'
const LOCK_FILE = 'package-lock.json'
const UNREACHABLE_REGISTRY = '--registry=http://127.0.0.1:9/'

export const packsDirOf = (stagingRoot: string): string => `${stagingRoot}/packs`

const readPackedManifest = (tarball: string) =>
  Effect.flatMap(
    runChecked(['tar', '-xzOf', tarball, 'package/package.json'], '.'),
    (outcome) => S.decodeEffect(S.fromJsonString(PackedManifest))(outcome.stdout),
  )

const workspaceOf = (repoRoot: string) =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const listing = yield* runChecked(['pnpm', 'ls', '-r', '--depth', '-1', '--json'], repoRoot)
    const packages = yield* S.decodeEffect(WorkspaceListingJson)(listing.stdout)
    return yield* Effect.forEach(packages, (entry) =>
      fs.readFileString(path.join(entry.path, MANIFEST_FILE)).pipe(
        Effect.flatMap(S.decodeEffect(S.fromJsonString(WorkspaceManifest))),
      ))
  })

export interface RepoLockInput {
  readonly repoRoot: string
  readonly stagingRoot: string
}

export const repoLockContextOf = ({ repoRoot, stagingRoot }: RepoLockInput) =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const workspace = yield* workspaceOf(repoRoot)
    const names = closureMembersOf(workspace)
    const packs = packsDirOf(stagingRoot)
    yield* fs.makeDirectory(packs, { recursive: true })
    yield* runChecked(
      ['pnpm', '-r', ...names.map((name) => `--filter=${name}`), 'pack', '--out', path.join(packs, '%s.tgz')],
      repoRoot,
    )
    const manifests = yield* Effect.forEach(names, (name) => readPackedManifest(path.join(packs, tarballFileOf(name))))
    return {
      stagingRoot,
      members: manifests.map(packedMemberOf),
      workspace: workspace.map((manifest) => manifest.name),
      pnpmLockfile: yield* fs.readFileString(path.join(repoRoot, 'pnpm-lock.yaml')),
      workspaceYaml: yield* fs.readFileString(path.join(repoRoot, 'pnpm-workspace.yaml')),
      npmArgs: [],
    } satisfies LockContext
  })

export const fixturesOf = (resourcesDir: string) =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const entries = yield* fs.readDirectory(resourcesDir)
    const fixtures = yield* Effect.filter(entries.sort(), (entry) =>
      fs.exists(path.join(resourcesDir, entry, MANIFEST_FILE)))
    return fixtures.map((fixtureId): FixtureSource => ({ fixtureId, dir: path.join(resourcesDir, fixtureId) }))
  })

interface StagedManifest {
  readonly relativePath: string
  readonly lockKey: string
  readonly document: FixtureManifestDocument
}

interface StagedFixture {
  readonly dir: string
  readonly manifests: ReadonlyArray<StagedManifest>
  readonly closure: ReadonlyArray<string>
  readonly pins: Readonly<Record<string, string>>
}

const isFixtureManifest = (entry: string): boolean => {
  const segments = entry.split('/')
  return segments.at(-1) === MANIFEST_FILE && !segments.includes('node_modules')
}

const manifestPathsOf = (dir: string) =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const entries = yield* fs.readDirectory(dir, { recursive: true })
    return entries.filter(isFixtureManifest).sort()
  })

const lockKeyOf = (relativePath: string): string => relativePath.split('/').slice(0, -1).join('/')

const stageFixture = (context: LockContext, fixture: FixtureSource) =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const relativePaths = yield* manifestPathsOf(fixture.dir)
    const manifests = yield* Effect.forEach(relativePaths, (relativePath) =>
      Effect.map(fs.readFile(path.join(fixture.dir, relativePath)), (bytes) => ({ relativePath, bytes })))
    const staged = yield* Effect.fromResult(stagedFixtureOf({
      fixtureId: fixture.fixtureId,
      manifests,
      members: context.members,
      workspace: context.workspace,
      pnpmLockfile: context.pnpmLockfile,
      workspaceYaml: context.workspaceYaml,
    }))
    const dir = path.join(context.stagingRoot, 'baked', fixture.fixtureId)
    yield* Effect.forEach(staged.manifests, (manifest) =>
      Effect.andThen(
        fs.makeDirectory(path.dirname(path.join(dir, manifest.relativePath)), { recursive: true }),
        Effect.flatMap(
          manifestFileOf(manifest.document),
          (text) =>
            fs.writeFileString(path.join(dir, manifest.relativePath), text),
        ),
      ))
    return {
      dir,
      manifests: staged.manifests.map((manifest): StagedManifest => ({
        ...manifest,
        lockKey: lockKeyOf(manifest.relativePath),
      })),
      closure: staged.closure,
      pins: staged.pins,
    } satisfies StagedFixture
  })

const JSON_FILE = { space: 2 } as const

const withNewline = (text: string): string => `${text}\n`

const manifestFileOf = (document: Readonly<Record<string, S.Json>>) =>
  Effect.map(S.encodeEffect(S.fromJsonString(S.Record(S.String, S.Json), JSON_FILE))(document), withNewline)

const lockFileOf = (lock: NpmLockfile) =>
  Effect.map(S.encodeEffect(S.fromJsonString(NpmLockfile, JSON_FILE))(lock), withNewline)

const committedLockOf = (fixture: FixtureSource) =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const file = path.join(fixture.dir, LOCK_FILE)
    return (yield* fs.exists(file))
      ? Option.some(yield* Effect.flatMap(fs.readFileString(file), S.decodeEffect(NpmLockfileJson)))
      : Option.none<NpmLockfile>()
  })

const NpmLsJson = S.fromJsonString(S.Struct({ problems: S.String.pipe(S.Array, S.optionalKey) }))

const lockProblemsOf = (context: LockContext, staged: StagedFixture, lock: NpmLockfile) =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    yield* fs.writeFileString(
      path.join(staged.dir, LOCK_FILE),
      yield* lockFileOf(overlayOf({ lock, members: context.members })),
    )
    const listed = yield* runCommand({
      argv: ['npm', 'ls', '--package-lock-only', '--all', '--json', '--offline', UNREACHABLE_REGISTRY],
      cwd: staged.dir,
    })
    return yield* S.decodeEffect(NpmLsJson)(listed.stdout).pipe(
      Effect.map((report) => report.problems ?? []),
      Effect.orElseSucceed(() => [listed.stderr.trim()]),
      Effect.map((problems) => (listed.exitCode === 0 ? [] : problems)),
    )
  })

export interface FixtureLockInput {
  readonly context: LockContext
  readonly fixture: FixtureSource
}

export const checkFixtureLock = ({ context, fixture }: FixtureLockInput) =>
  Effect.gen(function*() {
    const staged = yield* stageFixture(context, fixture)
    const lock = yield* committedLockOf(fixture)
    const findings = Arr.getSuccesses([
      findLockDrift(FindLockDriftCommand.make({
        fixtureId: fixture.fixtureId,
        lock: Option.getOrNull(lock),
        manifests: staged.manifests.map((manifest) => ({ lockKey: manifest.lockKey, manifest: manifest.document })),
        closure: staged.closure,
        pins: staged.pins,
      })),
    ]).flat()
    const problems = yield* Option.match(lock, {
      onNone: () => Effect.succeed([]),
      onSome: (committed) => lockProblemsOf(context, staged, committed),
    })
    return { fixtureId: fixture.fixtureId, findings, problems } satisfies FixtureLockReport
  })

export const lockFixture = ({ context, fixture }: FixtureLockInput) =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const staged = yield* stageFixture(context, fixture)
    const committed = yield* committedLockOf(fixture)
    yield* Option.match(committed, {
      onNone: () => Effect.void,
      onSome: (lock) =>
        Effect.flatMap(
          lockFileOf(overlayOf({ lock, members: context.members })),
          (text) => fs.writeFileString(path.join(staged.dir, LOCK_FILE), text),
        ),
    })
    yield* runChecked(
      ['npm', 'install', '--package-lock-only', '--ignore-scripts', '--no-audit', '--no-fund', ...context.npmArgs],
      staged.dir,
    )
    const generated = yield* Effect.flatMap(
      fs.readFileString(path.join(staged.dir, LOCK_FILE)),
      S.decodeEffect(NpmLockfileJson),
    )
    yield* fs.writeFileString(path.join(fixture.dir, LOCK_FILE), yield* lockFileOf(committableLockOf(generated)))
  })

const NEXT_ACTION = 'pnpm --filter @systemfsoftware/stryker-e2e-core fixtures:lock'

const findingTextOf = Match.type<LockDrift>().pipe(
  Match.tagsExhaustive({
    LockMissing: () => 'the fixture has no package-lock.json',
    RootOutOfSync: (finding) =>
      `${finding.packageName}: ${finding.manifest || 'the root'} manifest differs from the lock`,
    ClosureMemberMissing: (finding) => `${finding.packageName}: closure member missing from the lock`,
    ClosureMemberExtra: (finding) => `${finding.packageName}: the lock names a package the closure no longer packs`,
    PinMoved: (finding) =>
      `${finding.packageName}: pnpm-lock.yaml pins ${finding.pinned}, the lock has ${finding.locked}`,
  }),
)

export const driftLinesOf = (report: FixtureLockReport): ReadonlyArray<string> =>
  [...report.findings.map(findingTextOf), ...report.problems].map((detail) =>
    `E2E_PINS_DRIFT: ${report.fixtureId}: ${detail}. Next: ${NEXT_ACTION}, then commit test/e2e/testResources/${report.fixtureId}/${LOCK_FILE}`
  )
