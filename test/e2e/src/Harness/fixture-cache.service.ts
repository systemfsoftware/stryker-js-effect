import type { Readiness } from '@systemfsoftware/effect-readiness'
import {
  Array,
  Boolean,
  Cache,
  Config,
  Context,
  Effect,
  FileSystem,
  Layer,
  Match,
  Option,
  Path,
  Schema,
  Scope,
  Stream,
} from 'effect'
import * as Digest from 'effect/crypto/Digest'
import * as SecureRandom from 'effect/crypto/SecureRandom'
import type { PlatformError } from 'effect/PlatformError'
import { ChildProcess, ChildProcessSpawner } from 'effect/process'

import {
  committableLockOf,
  type FileBytes,
  type FixtureInput,
  fixtureKeyBytes,
  missingFixtures as missingFixturesWorkflow,
  MissingFixturesCommand,
  type PackInput,
  packsKeyBytes,
  parseWorkspaceCatalogs,
  pruneStaleEntries as pruneStaleEntriesWorkflow,
  PruneStaleEntriesCommand,
  resolvedManifestText,
  type WorkspaceCatalogs,
} from '@systemfsoftware/stryker-e2e-core'

import type { BakeOutcome } from './bake-key.schema.js'
import { FixtureKeys } from './bake-key.schema.js'
import { GuestJobs } from './guest-job.service.js'
import { ExitFailure, FixtureMissingFailure } from './harness-failure.schema.js'
import type { HarnessError } from './harness-failure.schema.js'
import { seamSpan, SpanNames, withSeamSpan } from './harness-telemetry.js'
import * as Warm from './warm-sandbox.handle.js'

export type BakePlatform =
  | GuestJobs
  | ChildProcessSpawner.ChildProcessSpawner
  | Digest.Digest
  | SecureRandom.SecureRandom
  | FileSystem.FileSystem
  | Path.Path
  | Readiness.HostProber

type StagePlatform = ChildProcessSpawner.ChildProcessSpawner | FileSystem.FileSystem | Path.Path

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
const STEP_PACKAGE = "build the flake's stryker package"
const STEP_PACKAGE_COPY = 'copy the read-only package to a mountable directory'
const PACKAGE_COPY_DIR = '.stryker-package'
const STEP_LOCK = 'regenerate a fixture lock'

const TREE_CONCURRENCY = 16
const KEY_CONCURRENCY = 4
const STAGE_CONCURRENCY = 4

type Argv = readonly [string, ...Array<string>]

const LOCK_ONLY_INSTALL: Argv = ['npm', 'install', '--package-lock-only', '--ignore-scripts', '--no-audit', '--no-fund']

const STAGED_FIXTURES_DIR = 'baked'
const STRYKER_PACKAGE: Argv = ['nix', 'build', '--no-link', '--print-out-paths', '.#stryker']
const LOCKFILE_NAME = 'package-lock.json'
const JSON_INDENT = 2

const JsonText = Schema.fromJsonString(Schema.Json)

const jsonTextOf = (json: Schema.Json): string => `${JSON.stringify(json, null, JSON_INDENT)}\n`

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
const MANIFEST_FILE_NAME = 'package.json'

const isManifestPath = (relativePath: string): boolean => relativePath.split('/').pop() === MANIFEST_FILE_NAME

const loadWorkspaceCatalogs = (environment: BakeEnvironment) =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const text = yield* fs.readFileString(path.join(environment.repoRoot, WORKSPACE_CATALOGS_FILE))
    return parseWorkspaceCatalogs(text)
  })

const resolveManifestBytes = (manifest: string, bytes: Uint8Array, catalogs: WorkspaceCatalogs) =>
  Effect.map(
    Effect.fromResult(resolvedManifestText(manifest, bytes, catalogs)),
    (text) => new TextEncoder().encode(text),
  )

const resolveTreeManifests = (label: string, files: ReadonlyArray<FileBytes>, catalogs: WorkspaceCatalogs) =>
  Effect.forEach(
    files,
    (file) =>
      Boolean.match(isManifestPath(file.relativePath), {
        onTrue: () =>
          Effect.map(
            resolveManifestBytes(`${label}/${file.relativePath}`, file.bytes, catalogs),
            (bytes): FileBytes => ({
              relativePath: file.relativePath,
              bytes,
            }),
          ),
        onFalse: () => Effect.succeed(file),
      }),
    { concurrency: 1 },
  )

const rewriteStagedManifests = (label: string, fixtureDir: string, catalogs: WorkspaceCatalogs) =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const entries = yield* listTree(fixtureDir)
    yield* Effect.forEach(
      Array.filter(entries, (entry) => entry.kind === 'file' && isManifestPath(entry.relativePath)),
      (entry) =>
        Effect.gen(function*() {
          const manifestPath = path.join(fixtureDir, entry.relativePath)
          const bytes = yield* fs.readFile(manifestPath)
          const resolved = yield* resolveManifestBytes(`${label}/${entry.relativePath}`, bytes, catalogs)
          yield* fs.writeFile(manifestPath, resolved)
        }),
      { discard: true, concurrency: 1 },
    )
  })

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
  fixtureIds: ReadonlyArray<string>,
  catalogs: WorkspaceCatalogs,
) =>
  Effect.forEach(
    fixtureIds,
    (fixtureId) =>
      Effect.gen(function*() {
        const fs = yield* FileSystem.FileSystem
        const path = yield* Path.Path
        const destination = path.join(stagingDir, fixtureId)
        yield* fs.copy(path.join(environment.resourcesDir, fixtureId), destination)
        yield* fs.remove(path.join(destination, 'node_modules'), { recursive: true, force: true })
        yield* rewriteStagedManifests(fixtureId, destination, catalogs)
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
    const secureRandom = yield* SecureRandom.SecureRandom
    const id = yield* secureRandom.uuidV4()
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

const hashOf = (digest: Digest.Digest['Service'], bytes: Uint8Array) => digest.digestHex(Digest.sha256, bytes)

const keysRecordOf = (fixtures: ReadonlyArray<BakedFixture>): FixtureKeys =>
  Object.fromEntries(fixtures.map((fixture) => [fixture.fixtureId, fixture.key]))

const fixtureInputsOf = (
  environment: BakeEnvironment,
  fixtureIds: ReadonlyArray<string>,
  catalogs: WorkspaceCatalogs,
): Effect.Effect<ReadonlyArray<FixtureInput>, ExitFailure | PlatformError | HarnessError, StagePlatform> =>
  Effect.forEach(
    fixtureIds,
    (fixtureId) =>
      withSeamSpan(
        SpanNames.fixtureKey,
        { 'e2e.fixture': fixtureId },
        Effect.gen(function*() {
          const path = yield* Path.Path
          const files = yield* readTreeBytes(path.join(environment.resourcesDir, fixtureId))
          const resolved = yield* resolveTreeManifests(fixtureId, files, catalogs)
          return { fixtureId, files: resolved.map(canonicalFile) }
        }),
      ),
    { concurrency: KEY_CONCURRENCY },
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
    const digest = yield* Digest.Digest
    const packsKey = yield* hashOf(digest, packsKeyBytes(packsInput))
    const fixtures = yield* Effect.forEach(
      fixtureInputs,
      (input) =>
        Effect.map(
          hashOf(digest, fixtureKeyBytes(input)),
          (key): BakedFixture => ({ fixtureId: input.fixtureId, key }),
        ),
      { concurrency: KEY_CONCURRENCY },
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

const strykerPackageOf = (environment: BakeEnvironment) =>
  Effect.map(
    withSeamSpan(SpanNames.packageBuild, {}, runChecked(STEP_PACKAGE, STRYKER_PACKAGE, environment.repoRoot)),
    (built) => built.stdout.trim(),
  )

const packageInputOf = (
  environment: BakeEnvironment,
  packagePath: string,
): Effect.Effect<PackInput, PlatformError, FileSystem.FileSystem> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const bakeScript = yield* fs.readFile(environment.bakeScriptPath)
    const identity = { relativePath: packagePath, bytes: new Uint8Array() }
    return { baseImage: GuestJobs.BASE_IMAGE, bakeScript, packs: [{ fileName: 'stryker', files: [identity] }] }
  })

const bakeMissing = (
  environment: BakeEnvironment,
  packagePath: string,
  root: string,
  missing: ReadonlyArray<BakedFixture>,
  catalogs: WorkspaceCatalogs,
) =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const secureRandom = yield* SecureRandom.SecureRandom
    const jobs = yield* GuestJobs
    const stagingDir = `${root}${STAGING_MARKER}${yield* secureRandom.uuidV4()}`
    yield* Effect.gen(function*() {
      yield* fs.remove(stagingDir, { recursive: true, force: true })
      yield* fs.makeDirectory(stagingDir, { recursive: true })
      yield* leaseEntry(stagingDir)
      yield* stageFixtures(environment, stagingDir, missing.map((fixture) => fixture.fixtureId), catalogs)
      const packageCopy = path.join(stagingDir, PACKAGE_COPY_DIR)
      yield* runChecked(STEP_PACKAGE_COPY, ['cp', '-R', packagePath, packageCopy])
      yield* runChecked(STEP_PACKAGE_COPY, ['chmod', '-R', 'u+w', packageCopy])
      const bakeScript = yield* fs.readFileString(environment.bakeScriptPath)
      yield* jobs.requireCleanExit(STEP_BAKE, ['sh', '-c', bakeScript, 'bake-fixtures'], [
        { host: stagingDir, guest: GuestJobs.GUEST_BAKED_ROOT },
        { host: packageCopy, guest: GuestJobs.GUEST_STRYKER_ROOT },
      ])
      yield* Effect.forEach(
        missing,
        (fixture) => publishFixture(stagingDir, fixture, path.join(root, entryNameOf(fixture))),
        { discard: true, concurrency: KEY_CONCURRENCY },
      )
    }).pipe(Effect.ensuring(fs.remove(stagingDir, { recursive: true, force: true }).pipe(Effect.orDie)))
  }).pipe(
    seamSpan(SpanNames.bake, {
      'e2e.fixtures': missing.length,
      'e2e.fixture.ids': missing.map((fixture) => fixture.fixtureId).sort().join(','),
    }),
  )

const lockFixtures = (environment: BakeEnvironment) =>
  Effect.scoped(Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const scratch = yield* fs.makeTempDirectoryScoped({ prefix: 'stryker-e2e-fixture-locks-' })
    const stagedDir = path.join(scratch, STAGED_FIXTURES_DIR)
    const fixtureIds = yield* listFixtureIds(environment)
    const catalogs = yield* loadWorkspaceCatalogs(environment)
    yield* stageFixtures(environment, stagedDir, fixtureIds, catalogs)
    yield* Effect.forEach(fixtureIds, (fixtureId) =>
      Effect.gen(function*() {
        yield* runChecked(STEP_LOCK, LOCK_ONLY_INSTALL, path.join(stagedDir, fixtureId))
        const lock = yield* fs.readFileString(path.join(stagedDir, fixtureId, LOCKFILE_NAME))
        const committable = committableLockOf(yield* Effect.orDie(Schema.decodeEffect(JsonText)(lock)))
        yield* fs.writeFileString(
          path.join(environment.resourcesDir, fixtureId, LOCKFILE_NAME),
          jsonTextOf(committable),
        )
        yield* Effect.log(`locked ${fixtureId}`)
      }), { discard: true })
  }))

const bake = (environment: BakeEnvironment): Effect.Effect<BakeOutcome, HarnessError, BakePlatform> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const packagePath = yield* strykerPackageOf(environment)
    const fixtureIds = yield* listFixtureIds(environment)
    const catalogs = yield* loadWorkspaceCatalogs(environment)
    const packageInput = yield* packageInputOf(environment, packagePath)
    const fixtureInputs = yield* fixtureInputsOf(environment, fixtureIds, catalogs)
    const { packsKey, fixtures } = yield* deriveBakeKeys(packageInput, fixtureInputs)
    const root = path.join(environment.bakedCacheRoot, packsKey)
    yield* fs.makeDirectory(root, { recursive: true })
    const lease = yield* leaseEntry(root)
    const missing = yield* missingFixtures(root, fixtures)
    yield* Boolean.match(missing.length === 0, {
      onTrue: () => Effect.void,
      onFalse: () => bakeMissing(environment, packagePath, root, missing, catalogs),
    })
    return { root, keys: keysRecordOf(fixtures), lease }
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
    bakeScriptPath: path.join(packageDir, 'tests', '__fixtures__', 'bake-fixtures.sh'),
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
    Effect.flatMap(bakeEnvironment, bake),
  )

  static readonly lockProgram = Effect.flatMap(bakeEnvironment, lockFixtures)

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
