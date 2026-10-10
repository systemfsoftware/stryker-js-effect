import { MicroVM } from '@systemfsoftware/effect-microsandbox'
import type { Readiness } from '@systemfsoftware/effect-readiness'
import {
  Array,
  Boolean,
  Cache,
  Cause,
  Clock,
  Config,
  Context,
  Crypto,
  Effect,
  Exit,
  FileSystem,
  Layer,
  Match,
  Option,
  Path,
  Ref,
  Schema,
  Scope,
  Stream,
} from 'effect'
import { Hex } from 'effect/encoding'
import type { PlatformError } from 'effect/PlatformError'
import { ChildProcess, ChildProcessSpawner } from 'effect/process'

import {
  BAKE_INSTALL_DEADLINE_SECONDS,
  BAKE_LANES,
  bakeBudgetSeconds,
  BakeDone,
  BakeFailed,
  type BakeReason,
  bakeReasonsOf,
  BakeReportJson,
  bakeReportOf,
  closureMembersOf,
  type FileBytes,
  type FixtureInput,
  fixtureKeyBytes,
  missingFixtures as missingFixturesWorkflow,
  MissingFixturesCommand,
  NpmLockfileJson,
  overBudgetReason,
  overlayOf,
  PackedManifest,
  type PackedMember,
  packedMemberOf,
  type PackedTree,
  type PackInput,
  packsKeyBytes,
  pruneStaleEntries as pruneStaleEntriesWorkflow,
  PruneStaleEntriesCommand,
  setupFailedReason,
  stagedFixtureOf,
  tarballFileOf,
  WorkspaceListingJson,
  WorkspaceManifest,
  type WorkspaceManifests,
} from '@systemfsoftware/stryker-e2e-core'

import type { BakeOutcome, PackedPackage } from './bake-key.schema.js'
import { FixtureKeys } from './bake-key.schema.js'
import { GuestJobs } from './guest-job.service.js'
import { BakeOverBudgetFailure, ExitFailure, FixtureMissingFailure, PackFailure } from './harness-failure.schema.js'
import type { HarnessError } from './harness-failure.schema.js'
import { seamSpan, SpanNames, withSeamSpan } from './harness-telemetry.service.js'
import * as Warm from './warm-sandbox.handle.js'

export type BakePlatform =
  | GuestJobs
  | ChildProcessSpawner.ChildProcessSpawner
  | Crypto.Crypto
  | FileSystem.FileSystem
  | Path.Path
  | Readiness.HostProber

interface BakedFixture {
  readonly fixtureId: string
  readonly key: string
}
interface CommandOutcome {
  readonly exitCode: number
  readonly stdout: string
  readonly stderr: string
}

interface TreeEntry {
  readonly relativePath: string
  readonly kind: 'file' | 'directory'
}

interface BakeEnvironment {
  readonly repoRoot: string
  readonly resourcesDir: string
  readonly bakedCacheRoot: string
  readonly bakeScriptPath: string
}

const STEP_BAKE = 'bake every fixture in the preparation microVM'
const STEP_BAKE_BOOT = 'pull the guest image and boot the preparation microVM'
const STEP_CLOSURE = 'build the packed workspace closure'
const STEP_TARBALLS = 'read the packed tarballs'
const STEP_KEY = 'derive the bake cache key'
const STEP_INSTALL_PLAN = 'plan the workspace closure install'

const TREE_CONCURRENCY = 16
const UNPACK_CONCURRENCY = 4
const STAGE_CONCURRENCY = 4

type Argv = readonly [string, ...Array<string>]
const PACKED_MANIFEST_PATH = 'package/package.json'

const runCommand = (argv: Argv, cwd?: string) =>
  Effect.scoped(Effect.gen(function*() {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
    const [command, ...args] = argv
    const handle = yield* spawner.spawn(ChildProcess.make(command, args, cwd === undefined ? {} : { cwd }))
    const [stdout, stderr, exitCode] = yield* Effect.all(
      [
        Stream.runCollect(Stream.decodeText(handle.stdout)),
        Stream.runCollect(Stream.decodeText(handle.stderr)),
        handle.exitCode,
      ] as const,
      { concurrency: 'unbounded' },
    )
    return { exitCode, stdout: stdout.join(''), stderr: stderr.join('') }
  }))

const requireZeroExit = (step: string, outcome: CommandOutcome) =>
  Boolean.match(outcome.exitCode === 0, {
    onTrue: () => Effect.succeed(outcome),
    onFalse: () =>
      Effect.fail(
        new ExitFailure({
          step,
          exitCode: outcome.exitCode,
          stderrTail: outcome.stderr.slice(-GuestJobs.STDERR_TAIL_CHARS),
        }),
      ),
  })

const runChecked = (step: string, argv: Argv, cwd?: string) =>
  Effect.flatMap(runCommand(argv, cwd), (outcome) => requireZeroExit(step, outcome))

const listTree = (root: string) =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const relativePaths = yield* fs.readDirectory(root, { recursive: true })
    const entries = yield* Effect.forEach(
      Array.filter(relativePaths, (relativePath) => !relativePath.split('/').includes('node_modules')),
      (relativePath) =>
        Effect.map(fs.stat(path.join(root, relativePath)), (info) =>
          Match.value(info.type).pipe(
            Match.when('File', () => Option.some<TreeEntry>({ relativePath, kind: 'file' })),
            Match.when('Directory', () => Option.some<TreeEntry>({ relativePath, kind: 'directory' })),
            Match.orElse(() => Option.none<TreeEntry>()),
          )),
      { concurrency: TREE_CONCURRENCY },
    )
    return Array.getSomes(entries).sort((left, right) => left.relativePath.localeCompare(right.relativePath))
  })

const readTreeBytes = (root: string) =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const entries = yield* listTree(root)
    return yield* Effect.forEach(
      Array.filter(entries, (entry) => entry.kind === 'file'),
      (entry) =>
        Effect.map(fs.readFile(path.join(root, entry.relativePath)), (bytes): FileBytes => ({
          relativePath: entry.relativePath,
          bytes,
        })),
      { concurrency: TREE_CONCURRENCY },
    )
  })

const WORKSPACE_CATALOGS_FILE = 'pnpm-workspace.yaml'
const WORKSPACE_LOCKFILE = 'pnpm-lock.yaml'
const MANIFEST_FILE_NAME = 'package.json'
const LOCKFILE_NAME = 'package-lock.json'
const LOCK_DIGEST_CHARS = 16
const MANIFEST_JSON_INDENT = 2

interface StagingContext {
  readonly members: ReadonlyArray<PackedMember>
  readonly workspace: ReadonlyArray<string>
  readonly pnpmLockfile: string
  readonly workspaceYaml: string
}

const isManifestPath = (relativePath: string): boolean => relativePath.split('/').pop() === MANIFEST_FILE_NAME

const isLockPath = (relativePath: string): boolean => relativePath === LOCKFILE_NAME

const isStagedPath = (relativePath: string): boolean => isManifestPath(relativePath) || isLockPath(relativePath)

const manifestBytesOf = (document: unknown): Uint8Array =>
  new TextEncoder().encode(`${JSON.stringify(document, null, MANIFEST_JSON_INDENT)}\n`)

const overlaidLockOf = (fixtureId: string, bytes: Uint8Array, members: ReadonlyArray<PackedMember>) =>
  Schema.decodeEffect(NpmLockfileJson)(new TextDecoder().decode(bytes)).pipe(
    Effect.flatMap((lock) => Schema.encodeEffect(NpmLockfileJson)(overlayOf({ lock, members }))),
    Effect.map((text) => new TextEncoder().encode(text)),
    Effect.mapError((error) =>
      new PackFailure({ step: STEP_INSTALL_PLAN, detail: `${fixtureId}/${LOCKFILE_NAME}: ${error.message}` })
    ),
  )

const stageFixtureFiles = (fixtureId: string, files: ReadonlyArray<FileBytes>, context: StagingContext) =>
  Effect.fromResult(stagedFixtureOf({
    fixtureId,
    manifests: Array.filter(files, (file) => isManifestPath(file.relativePath)),
    ...context,
  })).pipe(
    Effect.mapError((failure) =>
      Match.value(failure).pipe(
        Match.tag(
          'UnpackedWorkspaceDependency',
          'ConflictingAliasTargets',
          'FixtureNamesWorkspacePackage',
          (refused) => new PackFailure({ step: STEP_INSTALL_PLAN, detail: refused.message }),
        ),
        Match.orElse((unresolved) => unresolved),
      )
    ),
    Effect.flatMap((staged) => {
      const manifests = new Map(
        staged.manifests.map((manifest) => [manifest.relativePath, manifestBytesOf(manifest.document)] as const),
      )
      return Effect.forEach(files, (file) =>
        Effect.map(
          Boolean.match(isLockPath(file.relativePath), {
            onTrue: () => overlaidLockOf(fixtureId, file.bytes, context.members),
            onFalse: () => Effect.succeed(manifests.get(file.relativePath) ?? file.bytes),
          }),
          (bytes): FileBytes => ({ relativePath: file.relativePath, bytes }),
        ))
    }),
  )

const listFixtureIds = (environment: BakeEnvironment) =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const entries = yield* fs.readDirectory(environment.resourcesDir)
    const kept = yield* Effect.forEach(
      entries,
      (entry) =>
        Effect.map(fs.exists(path.join(environment.resourcesDir, entry, MANIFEST_FILE_NAME)), (exists) =>
          Boolean.match(exists, {
            onTrue: () => [entry],
            onFalse: () => [],
          })),
      { concurrency: 1 },
    )
    return kept.flat().sort()
  })

const stageFixtures = (
  environment: BakeEnvironment,
  stagingDir: string,
  fixtureInputs: ReadonlyArray<FixtureInput>,
) =>
  Effect.forEach(
    fixtureInputs,
    (input) =>
      Effect.gen(function*() {
        const fs = yield* FileSystem.FileSystem
        const path = yield* Path.Path
        const destination = path.join(stagingDir, input.fixtureId)
        yield* fs.copy(path.join(environment.resourcesDir, input.fixtureId), destination)
        yield* fs.remove(path.join(destination, 'node_modules'), { recursive: true, force: true })
        yield* Effect.forEach(
          Array.filter(input.files, (file) => isStagedPath(file.relativePath)),
          (file) => fs.writeFile(path.join(destination, file.relativePath), file.bytes),
          { discard: true },
        )
      }),
    { discard: true, concurrency: STAGE_CONCURRENCY },
  )

const publishFixture = (stagingDir: string, fixture: BakedFixture, entryDir: string) =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const stale = yield* fs.exists(entryDir)
    yield* Boolean.match(stale, {
      onTrue: () => Effect.asVoid(fs.remove(entryDir, { recursive: true, force: true })),
      onFalse: () => Effect.void,
    })
    yield* fs.rename(path.join(stagingDir, fixture.fixtureId), entryDir)
  })

const LEASE_PREFIX = '.lease-'
const LEASE_PENDING_PREFIX = '.lease-write-'
const STAGING_MARKER = '.staging-'
const LEASE_TTL_MS = 6 * 60 * 60 * 1000

const leaseEntry = (directory: string) =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const crypto = yield* Crypto.Crypto
    const id = yield* crypto.randomUUIDv4
    const file = path.join(directory, `${LEASE_PREFIX}${id}`)
    const pending = path.join(directory, `${LEASE_PENDING_PREFIX}${id}`)
    yield* fs.writeFileString(pending, String(Date.now()))
    yield* fs.rename(pending, file)
    return file
  })

const releaseLease = (file: string) =>
  Effect.flatMap(FileSystem.FileSystem, (fs) => fs.remove(file, { force: true }).pipe(Effect.orDie))

const leaseFresh = (contents: string, now: number): boolean => {
  const writtenAt = Number.parseInt(contents.trim(), 10)
  return Number.isFinite(writtenAt) && now - writtenAt < LEASE_TTL_MS
}

const isHeld = (directory: string) =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const names = yield* fs.readDirectory(directory)
    const now = Date.now()
    const held = yield* Effect.forEach(
      Array.filter(names, (name) => name.startsWith(LEASE_PREFIX)),
      (name) =>
        Effect.map(
          Effect.option(fs.readFileString(path.join(directory, name))),
          (contents) => Option.exists(contents, (text) => leaseFresh(text, now)),
        ),
      { concurrency: 'unbounded' },
    )
    return held.includes(true)
  })

const pruneStaleEntries = (environment: BakeEnvironment, keep: string) =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const entries = yield* fs.readDirectory(environment.bakedCacheRoot)
    const leased = yield* Effect.forEach(
      Array.filter(entries, (name) => name !== keep),
      (name) =>
        Effect.map(isHeld(path.join(environment.bakedCacheRoot, name)), (held) =>
          Boolean.match(held, {
            onTrue: (): ReadonlyArray<string> => [name],
            onFalse: (): ReadonlyArray<string> => [],
          })),
      { concurrency: 'unbounded' },
    )
    const plan = yield* Effect.fromResult(
      pruneStaleEntriesWorkflow(PruneStaleEntriesCommand.make({ entries, keep, leased: leased.flat() })),
    )
    yield* Effect.forEach(
      plan,
      (entry) => fs.remove(path.join(environment.bakedCacheRoot, entry.name), { recursive: true, force: true }),
      { discard: true, concurrency: 'unbounded' },
    )
  })

const isJsonObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

const isJsonArray = (value: unknown): value is ReadonlyArray<unknown> => Array.isArray(value)

const canonicalJson = (value: unknown): unknown =>
  Match.value(value).pipe(
    Match.when(isJsonArray, (items) => items.map(canonicalJson)),
    Match.when(isJsonObject, (record) =>
      Object.fromEntries(
        Object.entries(record)
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([key, entry]) => [key, canonicalJson(entry)]),
      )),
    Match.orElse((value) => value),
  )

const canonicalBytes = (relativePath: string, bytes: Uint8Array): Uint8Array =>
  Boolean.match(isManifestPath(relativePath), {
    onTrue: () => new TextEncoder().encode(JSON.stringify(canonicalJson(JSON.parse(new TextDecoder().decode(bytes))))),
    onFalse: () => bytes,
  })

const canonicalFile = (file: FileBytes): FileBytes => ({
  relativePath: file.relativePath,
  bytes: canonicalBytes(file.relativePath, file.bytes),
})

const hashOf = (crypto: Crypto.Crypto, bytes: Uint8Array) => Effect.map(crypto.digest('SHA-256', bytes), Hex.encode)

const keysRecordOf = (fixtures: ReadonlyArray<BakedFixture>): FixtureKeys =>
  Object.fromEntries(fixtures.map((fixture) => [fixture.fixtureId, fixture.key]))

const packedTarballOf = (fileNames: ReadonlyArray<string>, packageName: string, directory: string) => {
  const fileName = tarballFileOf(packageName)
  return Boolean.match(fileNames.includes(fileName), {
    onTrue: () =>
      Effect.succeed<PackedPackage>({ name: packageName, fileName, tarballPath: `${directory}/${fileName}` }),
    onFalse: () =>
      Effect.fail(new PackFailure({ step: STEP_TARBALLS, detail: `pnpm pack wrote no ${fileName} into ${directory}` })),
  })
}

const packWorkspaceClosure = (environment: BakeEnvironment, directory: string, members: ReadonlyArray<string>) =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const filters = members.map((packageName) => `--filter=${packageName}`)
    yield* withSeamSpan(
      SpanNames.packBuild,
      { 'e2e.packages': members.length },
      runChecked(STEP_CLOSURE, ['pnpm', 'exec', 'turbo', 'run', 'build', ...filters], environment.repoRoot),
    )
    yield* withSeamSpan(
      SpanNames.packTarballs,
      { 'e2e.packages': members.length },
      runChecked(
        `pack ${members.length} closure packages`,
        ['pnpm', '-r', ...filters, 'pack', '--out', `${directory}/%s.tgz`],
        environment.repoRoot,
      ),
    )
    const fileNames = yield* fs.readDirectory(directory)
    return yield* Effect.forEach(members, (packageName) => packedTarballOf(fileNames, packageName, directory))
  }).pipe(seamSpan(SpanNames.pack, {}))

const packsInputOf = (
  environment: BakeEnvironment,
  packs: ReadonlyArray<PackedPackage>,
  scratch: string,
): Effect.Effect<PackInput, ExitFailure | PlatformError | HarnessError, BakePlatform> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const bakeScript = yield* fs.readFile(environment.bakeScriptPath)
    const packedTrees = yield* Effect.forEach(
      packs,
      (pack) =>
        withSeamSpan(
          SpanNames.packsKeyUnpack,
          { 'e2e.pack': pack.fileName },
          Effect.gen(function*() {
            const target = path.join(scratch, 'unpacked', pack.fileName)
            yield* fs.makeDirectory(target, { recursive: true })
            yield* requireZeroExit(STEP_KEY, yield* runCommand(['tar', '-xzf', pack.tarballPath, '-C', target]))
            const files = yield* readTreeBytes(target)
            return { fileName: pack.fileName, files: files.map(canonicalFile) }
          }),
        ),
      { concurrency: UNPACK_CONCURRENCY },
    )
    return { baseImage: GuestJobs.BASE_IMAGE, bakeScript, packs: packedTrees }
  }).pipe(seamSpan(SpanNames.packsKey, { 'e2e.packs': packs.length }))

const workspaceOf = (environment: BakeEnvironment) =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const listing = yield* runChecked(
      STEP_INSTALL_PLAN,
      ['pnpm', 'ls', '-r', '--depth', '-1', '--json'],
      environment.repoRoot,
    )
    const projects = yield* Schema.decodeEffect(WorkspaceListingJson)(listing.stdout).pipe(
      Effect.mapError(() =>
        new PackFailure({ step: STEP_INSTALL_PLAN, detail: 'pnpm ls wrote no parseable workspace listing' })
      ),
    )
    return yield* Effect.forEach(projects, (project) =>
      Effect.flatMap(
        fs.readFileString(path.join(project.path, MANIFEST_FILE_NAME)),
        (text) =>
          Schema.decodeEffect(Schema.fromJsonString(WorkspaceManifest))(text).pipe(
            Effect.mapError(() =>
              new PackFailure({
                step: STEP_INSTALL_PLAN,
                detail: `${project.name}: ${project.path}/${MANIFEST_FILE_NAME} is not a readable workspace manifest`,
              })
            ),
          ),
      ))
  })

const closureMemberOf = (tree: PackedTree) =>
  Effect.gen(function*() {
    const unreadable = new PackFailure({
      step: STEP_INSTALL_PLAN,
      detail: `the packed tarball ${tree.fileName} carries no readable ${PACKED_MANIFEST_PATH}`,
    })
    const manifestFile = yield* Option.match(
      Array.findFirst(tree.files, (file) => file.relativePath === PACKED_MANIFEST_PATH),
      {
        onNone: () => Effect.fail(unreadable),
        onSome: (found) => Effect.succeed(found),
      },
    )
    const manifest = yield* Schema.decodeEffect(Schema.fromJsonString(PackedManifest))(
      new TextDecoder().decode(manifestFile.bytes),
    ).pipe(Effect.mapError(() => unreadable))
    return packedMemberOf(manifest)
  })

const stagingContextOf = (environment: BakeEnvironment, packsInput: PackInput, workspace: WorkspaceManifests) =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    return {
      members: yield* Effect.forEach(packsInput.packs, closureMemberOf),
      workspace: workspace.map((manifest) => manifest.name),
      pnpmLockfile: yield* fs.readFileString(path.join(environment.repoRoot, WORKSPACE_LOCKFILE)),
      workspaceYaml: yield* fs.readFileString(path.join(environment.repoRoot, WORKSPACE_CATALOGS_FILE)),
    } satisfies StagingContext
  })

const fixtureInputsOf = (
  environment: BakeEnvironment,
  fixtureIds: ReadonlyArray<string>,
  context: StagingContext,
): Effect.Effect<ReadonlyArray<FixtureInput>, ExitFailure | PlatformError | HarnessError, BakePlatform> =>
  Effect.forEach(
    fixtureIds,
    (fixtureId) =>
      withSeamSpan(
        SpanNames.fixtureKey,
        { 'e2e.fixture': fixtureId },
        Effect.gen(function*() {
          const path = yield* Path.Path
          const files = yield* readTreeBytes(path.join(environment.resourcesDir, fixtureId))
          return { fixtureId, files: yield* stageFixtureFiles(fixtureId, files, context) }
        }),
      ),
    { concurrency: UNPACK_CONCURRENCY },
  ).pipe(seamSpan(SpanNames.fixtureKeys, { 'e2e.fixtures': fixtureIds.length }))

interface DerivedBakeKeys {
  readonly packsKey: string
  readonly fixtures: ReadonlyArray<BakedFixture>
}

const deriveBakeKeys = (
  packsInput: PackInput,
  fixtureInputs: ReadonlyArray<FixtureInput>,
): Effect.Effect<DerivedBakeKeys, HarnessError, BakePlatform> =>
  Effect.gen(function*() {
    const crypto = yield* Crypto.Crypto
    const packsKey = yield* hashOf(crypto, packsKeyBytes(packsInput))
    const fixtures = yield* Effect.forEach(
      fixtureInputs,
      (input) =>
        Effect.map(
          hashOf(crypto, fixtureKeyBytes({ fixtureId: input.fixtureId, files: input.files.map(canonicalFile) })),
          (key): BakedFixture => ({ fixtureId: input.fixtureId, key }),
        ),
      { concurrency: UNPACK_CONCURRENCY },
    )
    return { packsKey, fixtures }
  })

const entryNameOf = (fixture: BakedFixture): string => `${fixture.fixtureId}.${fixture.key}`

const missingFixtures = (root: string, fixtures: ReadonlyArray<BakedFixture>) =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const present = yield* fs.readDirectory(root)
    const missing = yield* Effect.fromResult(
      missingFixturesWorkflow(MissingFixturesCommand.make({ fixtures, present })),
    )
    return missing.map((fixture): BakedFixture => ({ fixtureId: fixture.fixtureId, key: fixture.key }))
  })

const bakeArgv = [
  `--root=${GuestJobs.GUEST_BAKED_ROOT}`,
  `--deadline=${BAKE_INSTALL_DEADLINE_SECONDS}`,
  `--lanes=${BAKE_LANES}`,
]

interface BakePhases {
  readonly bootSeconds: number | null
  readonly installSeconds: number | null
}

const NOTHING_BAKED: BakePhases = { bootSeconds: null, installSeconds: null }

const secondsSince = (started: number) => Effect.map(Clock.currentTimeMillis, (now) => (now - started) / 1000)

const runBakeScript = (
  bakeScript: string,
  mounts: ReadonlyArray<MicroVM.Mount>,
  booted: Ref.Ref<Option.Option<number>>,
) =>
  Effect.scoped(Effect.gen(function*() {
    const jobs = yield* GuestJobs
    const started = yield* Clock.currentTimeMillis
    const vm = yield* jobs.boot(STEP_BAKE_BOOT, mounts)
    const bootSeconds = yield* secondsSince(started)
    yield* Ref.set(booted, Option.some(bootSeconds))
    const installing = yield* Clock.currentTimeMillis
    yield* jobs.requireCleanExec(STEP_BAKE, vm, ['sh', '-c', bakeScript, 'bake-fixtures', ...bakeArgv])
    return { bootSeconds, installSeconds: yield* secondsSince(installing) } satisfies BakePhases
  }))

const bakeMissing = (
  environment: BakeEnvironment,
  packsDir: string,
  root: string,
  missing: ReadonlyArray<BakedFixture>,
  fixtureInputs: ReadonlyArray<FixtureInput>,
) =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const crypto = yield* Crypto.Crypto
    const missingIds = missing.map((fixture) => fixture.fixtureId)
    const stagingDir = `${root}${STAGING_MARKER}${yield* crypto.randomUUIDv4}`
    return yield* Effect.gen(function*() {
      yield* fs.remove(stagingDir, { recursive: true, force: true })
      yield* fs.makeDirectory(stagingDir, { recursive: true })
      yield* leaseEntry(stagingDir)
      yield* stageFixtures(
        environment,
        stagingDir,
        fixtureInputs.filter((input) => missingIds.includes(input.fixtureId)),
      )
      const bakeScript = yield* fs.readFileString(environment.bakeScriptPath)
      const budgetSeconds = bakeBudgetSeconds({ fixtures: missing.length })
      const booted = yield* Ref.make(Option.none<number>())
      const phases = yield* runBakeScript(bakeScript, [
        { host: stagingDir, guest: GuestJobs.GUEST_BAKED_ROOT },
        { host: packsDir, guest: GuestJobs.GUEST_PACKS_ROOT },
      ], booted).pipe(Effect.timeoutOrElse({
        duration: `${budgetSeconds} seconds`,
        orElse: () =>
          Effect.flatMap(
            Ref.get(booted),
            (bootSeconds) =>
              Effect.fail(
                new BakeOverBudgetFailure({
                  budgetSeconds,
                  fixtures: missingIds,
                  bootSeconds: Option.getOrNull(bootSeconds),
                }),
              ),
          ),
      }))
      yield* Effect.forEach(
        missing,
        (fixture) => publishFixture(stagingDir, fixture, path.join(root, entryNameOf(fixture))),
        { discard: true, concurrency: UNPACK_CONCURRENCY },
      )
      return phases
    }).pipe(Effect.ensuring(fs.remove(stagingDir, { recursive: true, force: true }).pipe(Effect.orDie)))
  }).pipe(
    seamSpan(SpanNames.bake, {
      'e2e.fixtures': missing.length,
      'e2e.fixture.ids': missing.map((fixture) => fixture.fixtureId).sort().join(','),
    }),
  )

const lockDigestOf = (root: string, fixture: BakedFixture) =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const crypto = yield* Crypto.Crypto
    const bytes = yield* Effect.option(fs.readFile(path.join(root, entryNameOf(fixture), LOCKFILE_NAME)))
    const digest = yield* Option.match(bytes, {
      onNone: () => Effect.succeed('absent'),
      onSome: (present) => Effect.map(hashOf(crypto, present), (hex) => hex.slice(0, LOCK_DIGEST_CHARS)),
    })
    return [fixture.fixtureId, digest] as const
  })

const bake = (environment: BakeEnvironment): Effect.Effect<BakeOutcome, HarnessError, BakePlatform> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const scratch = yield* fs.makeTempDirectory({ prefix: 'stryker-e2e-packs-' })
    const packsDir = path.join(scratch, 'packs')
    return yield* Effect.gen(function*() {
      yield* fs.makeDirectory(packsDir)
      const workspace = yield* workspaceOf(environment)
      const packs = yield* packWorkspaceClosure(environment, packsDir, closureMembersOf(workspace))
      const fixtureIds = yield* listFixtureIds(environment)
      const packsInput = yield* packsInputOf(environment, packs, scratch)
      const context = yield* stagingContextOf(environment, packsInput, workspace)
      const fixtureInputs = yield* fixtureInputsOf(environment, fixtureIds, context)
      const { packsKey, fixtures } = yield* deriveBakeKeys(packsInput, fixtureInputs)
      const root = path.join(environment.bakedCacheRoot, packsKey)
      yield* fs.makeDirectory(root, { recursive: true })
      const lease = yield* leaseEntry(root)
      const missing = yield* missingFixtures(root, fixtures)
      const phases = yield* Boolean.match(missing.length === 0, {
        onTrue: () => Effect.succeed(NOTHING_BAKED),
        onFalse: () => bakeMissing(environment, packsDir, root, missing, fixtureInputs),
      })
      const locks = yield* Effect.forEach(fixtures, (fixture) => lockDigestOf(root, fixture), {
        concurrency: UNPACK_CONCURRENCY,
      })
      return {
        root,
        keys: keysRecordOf(fixtures),
        lease,
        baked: missing.length,
        locks: Object.fromEntries(locks),
        ...phases,
      }
    }).pipe(Effect.ensuring(fs.remove(scratch, { recursive: true, force: true }).pipe(Effect.orDie)))
  })

const RECORD_ENV = 'STRYKER_E2E_BAKE_RECORD'

const bakeReasonsOfError = (error: HarnessError): Array.NonEmptyReadonlyArray<BakeReason> =>
  Match.value(error).pipe(
    Match.when(
      { _tag: 'ExitFailure', step: STEP_BAKE },
      (failure): Array.NonEmptyReadonlyArray<BakeReason> => bakeReasonsOf(failure),
    ),
    Match.when({ _tag: 'BakeOverBudgetFailure' }, (failure): Array.NonEmptyReadonlyArray<BakeReason> => [
      overBudgetReason(failure),
    ]),
    Match.orElse((other): Array.NonEmptyReadonlyArray<BakeReason> => [setupFailedReason(other.message)]),
  )

const bakeRecordOf = (
  exit: Exit.Exit<BakeOutcome, HarnessError>,
  seconds: number,
  packsKeyOf: (root: string) => string,
) =>
  Exit.match(exit, {
    onSuccess: (outcome) =>
      new BakeDone({
        packsKey: packsKeyOf(outcome.root),
        fixtures: Object.keys(outcome.keys).length,
        baked: outcome.baked,
        seconds,
        bootSeconds: outcome.bootSeconds,
        installSeconds: outcome.installSeconds,
        locks: outcome.locks,
        entries: Object.entries(outcome.keys).map(([fixtureId, key]) => entryNameOf({ fixtureId, key })),
      }),
    onFailure: (cause) =>
      new BakeFailed({
        reasons: Option.match(Cause.findErrorOption(cause), {
          onNone: (): Array.NonEmptyReadonlyArray<BakeReason> => [setupFailedReason(Cause.pretty(cause))],
          onSome: bakeReasonsOfError,
        }),
        seconds,
      }),
  })

const writeBakeRecord = (exit: Exit.Exit<BakeOutcome, HarnessError>, seconds: number) =>
  Effect.gen(function*() {
    const target = yield* Config.option(Config.String(RECORD_ENV))
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    yield* Option.match(target, {
      onNone: () => Effect.void,
      onSome: (file) =>
        Effect.flatMap(
          Schema.encodeEffect(BakeReportJson)(bakeReportOf(bakeRecordOf(exit, seconds, path.basename))),
          (json) => fs.writeFileString(file, json),
        ),
    })
  }).pipe(Effect.ignore({ log: 'Warn', message: 'the bake record could not be written' }))

const recordedBake = (environment: BakeEnvironment): Effect.Effect<BakeOutcome, HarnessError, BakePlatform> =>
  Effect.gen(function*() {
    const started = yield* Clock.currentTimeMillis
    const exit = yield* Effect.exit(bake(environment))
    const finished = yield* Clock.currentTimeMillis
    yield* writeBakeRecord(exit, (finished - started) / 1000)
    return yield* exit
  })

const warmFixtureInto = (
  scope: Scope.Scope,
  fixtureUrl: URL,
): Effect.Effect<Warm.WarmSandbox, HarnessError, BakePlatform> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const hostFixtureDir = yield* path.fromFileUrl(fixtureUrl).pipe(Effect.orDie)
    const fixtureId = path.basename(hostFixtureDir)
    const stat = yield* Effect.option(fs.stat(hostFixtureDir))
    yield* Boolean.match(Option.exists(stat, (info) => info.type === 'Directory'), {
      onTrue: () => Effect.void,
      onFalse: () => Effect.fail(new FixtureMissingFailure({ directory: hostFixtureDir })),
    })
    const bakedRoot = yield* resolveBakedRoot
    const keys = yield* resolveFixtureKeys
    const key = yield* Option.match(Option.fromNullishOr(keys[fixtureId]), {
      onNone: () => Effect.fail(new FixtureMissingFailure({ directory: `${bakedRoot}/${fixtureId}` })),
      onSome: (present) => Effect.succeed(present),
    })
    const entryDir = path.join(bakedRoot, entryNameOf({ fixtureId, key }))
    const entryExists = yield* fs.exists(entryDir)
    yield* Boolean.match(entryExists, {
      onTrue: () => Effect.void,
      onFalse: () => Effect.fail(new FixtureMissingFailure({ directory: entryDir })),
    })
    return yield* Warm.boot(entryDir, fixtureId).pipe(Scope.provide(scope))
  }).pipe(seamSpan(SpanNames.install, { 'e2e.fixture': fixtureUrl.href }))

const bakeEnvironment = Effect.gen(function*() {
  const path = yield* Path.Path
  const packageDir = yield* path.fromFileUrl(new URL('../../', import.meta.url)).pipe(Effect.orDie)
  const environment: BakeEnvironment = {
    repoRoot: path.resolve(packageDir, '..', '..'),
    resourcesDir: path.join(packageDir, 'testResources'),
    bakedCacheRoot: path.join(packageDir, 'node_modules', '.cache', 'stryker-e2e', 'baked'),
    bakeScriptPath: path.join(packageDir, '..', 'e2e-core', 'bake', 'bake-fixtures.sh'),
  }
  return environment
})

export interface BakedFixtureCacheShape {
  readonly root: Effect.Effect<string, HarnessError>
  readonly warm: (fixtureUrl: URL) => Effect.Effect<Warm.WarmSandbox, HarnessError, BakePlatform>
}

export class BakedFixtureCache extends Context.Service<BakedFixtureCache, BakedFixtureCacheShape>()(
  '@systemfsoftware/stryker-e2e/Harness/BakedFixtureCache',
) {
  static readonly BAKED_ROOT_ENV = 'STRYKER_E2E_BAKED_ROOT'
  static readonly BAKED_KEYS_ENV = 'STRYKER_E2E_BAKED_FIXTURE_KEYS'

  static readonly bakeProgram: Effect.Effect<BakeOutcome, HarnessError, BakePlatform> = withSeamSpan(
    SpanNames.setup,
    {},
    Effect.flatMap(bakeEnvironment, recordedBake),
  )

  static readonly teardownProgram = (outcome: BakeOutcome): Effect.Effect<void, HarnessError, BakePlatform> =>
    Effect.gen(function*() {
      const path = yield* Path.Path
      yield* releaseLease(outcome.lease)
      yield* withSeamSpan(
        SpanNames.prune,
        {},
        Effect.flatMap(
          bakeEnvironment,
          (environment) => pruneStaleEntries(environment, path.basename(outcome.root)),
        ),
      )
    })

  static readonly layer = Layer.effect(
    BakedFixtureCache,
    Effect.gen(function*() {
      const scope = yield* Effect.scope
      const root = yield* Effect.cached(resolveBakedRoot)
      const warmed = yield* Cache.make({
        capacity: 16,
        lookup: (fixtureHref: string) => warmFixtureInto(scope, new URL(fixtureHref)),
        requireServicesAt: 'lookup',
      })
      return {
        root,
        warm: (fixtureUrl: URL) => Cache.get(warmed, fixtureUrl.href),
      }
    }),
  )
}

const resolveBakedRoot = Config.String(BakedFixtureCache.BAKED_ROOT_ENV)

const resolveFixtureKeys = Config.schema(
  Schema.fromJsonString(FixtureKeys),
  BakedFixtureCache.BAKED_KEYS_ENV,
)
