import type { Readiness } from '@systemfsoftware/effect-readiness'
import {
  Array,
  Boolean,
  Cache,
  Config,
  Context,
  Crypto,
  Effect,
  Encoding,
  FileSystem,
  Layer,
  Match,
  Option,
  Path,
  Result,
  Schema,
  Scope,
  Stream,
} from 'effect'
import type { PlatformError } from 'effect/PlatformError'
import { ChildProcess, ChildProcessSpawner } from 'effect/unstable/process'

import type { BakedInput, FileBytes, PackedPackage, PackedPackageLookup, TurboDryClosure } from './bake-key.schema.js'
import {
  FoundPackage,
  MalformedClosure,
  MissingTarball,
  TurboClosure,
  TurboDryRun,
  UnreadableVersion,
} from './bake-key.schema.js'
import type { WorkspaceCatalogs } from './catalog-resolution.js'
import { parseFixtureManifest, parseWorkspaceCatalogs, resolveCatalogSpecs } from './catalog-resolution.js'
import { GuestJobs } from './guest-job.service.js'
import { ExitFailure, FixtureMissingFailure, PackFailure } from './harness-failure.schema.js'
import type { HarnessError } from './harness-failure.schema.js'

export type BakePlatform =
  | GuestJobs
  | ChildProcessSpawner.ChildProcessSpawner
  | Crypto.Crypto
  | FileSystem.FileSystem
  | Path.Path
  | Readiness.HostProber

export interface FixtureRequest {
  readonly url: URL
  readonly name: string
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
const STEP_CLOSURE = 'build the packed workspace closure'
const STEP_TARBALLS = 'read the packed tarballs'
const STEP_KEY = 'derive the bake cache key'

const ENTRY_PACKAGES = [
  '@systemfsoftware/stryker-js',
  '@systemfsoftware/stryker-js-svelte',
  '@systemfsoftware/stryker-js-vitest-runner',
  '@systemfsoftware/stryker-js-typescript-checker',
] as const

type Argv = readonly [string, ...Array<string>]

const PACKED_TARBALL_VERSION = /-(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\.tgz$/

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
      { concurrency: 1 },
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
      { concurrency: 1 },
    )
  })

const WORKSPACE_CATALOGS_FILE = 'pnpm-workspace.yaml'
const MANIFEST_FILE_NAME = 'package.json'
const MANIFEST_JSON_INDENT = 2

const isManifestPath = (relativePath: string): boolean => relativePath.split('/').pop() === MANIFEST_FILE_NAME

const loadWorkspaceCatalogs = (environment: BakeEnvironment) =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const text = yield* fs.readFileString(path.join(environment.repoRoot, WORKSPACE_CATALOGS_FILE))
    return parseWorkspaceCatalogs(text)
  })

const resolveManifestBytes = (manifest: string, bytes: Uint8Array, catalogs: WorkspaceCatalogs) =>
  Effect.gen(function*() {
    const parsed = yield* Effect.fromResult(parseFixtureManifest(manifest, bytes))
    const resolved = yield* Effect.fromResult(resolveCatalogSpecs(manifest, parsed, catalogs))
    return new TextEncoder().encode(`${JSON.stringify(resolved, null, MANIFEST_JSON_INDENT)}\n`)
  })

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
    { discard: true, concurrency: 1 },
  )

const publishEntry = (stagingDir: string, entryDir: string) =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    yield* Effect.matchEffect(fs.rename(stagingDir, entryDir), {
      onSuccess: () => Effect.void,
      onFailure: (cause) =>
        Effect.gen(function*() {
          const entryExists = yield* fs.exists(entryDir)
          return yield* Boolean.match(entryExists, {
            onTrue: () => Effect.asVoid(fs.remove(stagingDir, { recursive: true, force: true })),
            onFalse: () => Effect.fail(cause),
          })
        }),
    })
  })

const pruneOtherEntries = (environment: BakeEnvironment, keep: string) =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const entries = yield* fs.readDirectory(environment.bakedCacheRoot)
    const stale = Array.filter(entries, (name) => name !== keep && !name.includes('.staging-'))
    yield* Effect.forEach(
      stale,
      (name) => fs.remove(path.join(environment.bakedCacheRoot, name), { recursive: true, force: true }),
      { discard: true },
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

const encodeChunk = (text: string) => new TextEncoder().encode(text)

const fileChunks = (label: string, files: ReadonlyArray<FileBytes>): ReadonlyArray<Uint8Array> =>
  [...files]
    .sort((left, right) => left.relativePath.localeCompare(right.relativePath))
    .flatMap((file) => [
      encodeChunk(`${label}\0${file.relativePath}\0`),
      canonicalBytes(file.relativePath, file.bytes),
      encodeChunk('\0'),
    ])

const keyBytes = (input: BakedInput): Uint8Array => {
  const chunks = [
    encodeChunk(`image\0${input.baseImage}\0`),
    encodeChunk('bake\0'),
    input.bakeScript,
    encodeChunk('\0'),
    ...[...input.packs]
      .sort((left, right) => left.fileName.localeCompare(right.fileName))
      .flatMap((pack) => fileChunks(`pack\0${pack.fileName}`, pack.files)),
    ...[...input.fixtures]
      .sort((left, right) => left.fixtureId.localeCompare(right.fixtureId))
      .flatMap((fixture) => fileChunks(`fixture\0${fixture.fixtureId}`, fixture.files)),
  ]
  const total = chunks.reduce((size, chunk) => size + chunk.length, 0)
  const bytes = new Uint8Array(total)
  chunks.reduce<[Uint8Array, number]>(
    ([target, offset], chunk) => {
      target.set(chunk, offset)
      return [target, offset + chunk.length]
    },
    [bytes, 0],
  )
  return bytes
}

const bakeCacheKey = (crypto: Crypto.Crypto, input: BakedInput) =>
  Effect.map(crypto.digest('SHA-256', keyBytes(input)), Encoding.encodeHex)

const packageNameOf = (task: typeof TurboDryRun.Type.tasks[number]): ReadonlyArray<string> =>
  Option.match(
    Option.filter(Option.fromNullishOr(task.package), () => task.command === 'build' || task.taskId.endsWith('#build')),
    {
      onNone: () => [],
      onSome: (packageName) => [packageName],
    },
  )

const resolveTurboDryClosure = (stdout: string): TurboDryClosure => {
  const jsonStart = stdout.indexOf('{')
  return Option.match(Option.filter(Option.some(jsonStart), (start) => start >= 0), {
    onNone: (): TurboDryClosure => MalformedClosure.make({}),
    onSome: (start): TurboDryClosure =>
      Result.match(Schema.decodeResult(Schema.fromJsonString(TurboDryRun))(stdout.slice(start)), {
        onFailure: (): TurboDryClosure => MalformedClosure.make({}),
        onSuccess: (dryRun): TurboDryClosure =>
          TurboClosure.make({ packages: [...Array.dedupe(dryRun.tasks.flatMap(packageNameOf))].sort() }),
      }),
  })
}
const lookupOf = (
  fileNames: ReadonlyArray<string>,
  packageName: string,
  directory: string,
): PackedPackageLookup => {
  const prefix = `${packageName.slice(1).replace('/', '-')}-`
  return Option.match(
    Array.findFirst(fileNames, (candidate) => candidate.startsWith(prefix) && candidate.endsWith('.tgz')),
    {
      onNone: (): PackedPackageLookup => MissingTarball.make({ prefix, directory }),
      onSome: (fileName): PackedPackageLookup =>
        Option.match(Option.fromNullishOr(PACKED_TARBALL_VERSION.exec(fileName)?.[1]), {
          onNone: (): PackedPackageLookup => UnreadableVersion.make({ fileName }),
          onSome: (version): PackedPackageLookup =>
            FoundPackage.make({
              pack: { name: packageName, version, fileName, tarballPath: `${directory}/${fileName}` },
            }),
        }),
    },
  )
}

const packedTarballOf = (fileNames: ReadonlyArray<string>, packageName: string, directory: string) =>
  Match.value(lookupOf(fileNames, packageName, directory)).pipe(
    Match.tag('Found', (lookup) => Effect.succeed(lookup.pack)),
    Match.tag('MissingTarball', (lookup) =>
      Effect.fail(
        new PackFailure({
          step: STEP_TARBALLS,
          detail: `pnpm pack wrote no ${lookup.prefix}*.tgz into ${lookup.directory}`,
        }),
      )),
    Match.tag('UnreadableVersion', (lookup) =>
      Effect.fail(
        new PackFailure({
          step: STEP_TARBALLS,
          detail: `the packed tarball ${lookup.fileName} carries no parseable version`,
        }),
      )),
    Match.exhaustive,
  )

const packWorkspaceClosure = (environment: BakeEnvironment, directory: string) =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const dryRun = yield* runChecked(
      STEP_CLOSURE,
      ['pnpm', 'exec', 'turbo', 'run', 'build', ...ENTRY_PACKAGES.map((entry) => `--filter=${entry}`), '--dry=json'],
      environment.repoRoot,
    )
    const closure = resolveTurboDryClosure(dryRun.stdout)
    return yield* Match.value(closure).pipe(
      Match.tag('Malformed', () =>
        Effect.fail(
          new PackFailure({
            step: STEP_CLOSURE,
            detail: 'the turbo dry run wrote no parseable closure document',
          }),
        )),
      Match.tag('Closure', (closure) =>
        Effect.gen(function*() {
          yield* runChecked(
            STEP_CLOSURE,
            [
              'pnpm',
              'exec',
              'turbo',
              'run',
              'build',
              ...closure.packages.map((packageName) => `--filter=${packageName}`),
            ],
            environment.repoRoot,
          )
          yield* Effect.forEach(
            closure.packages,
            (packageName) =>
              runChecked(`pack ${packageName}`, [
                'pnpm',
                '--filter',
                packageName,
                'pack',
                '--pack-destination',
                directory,
              ], environment.repoRoot),
            { discard: true },
          )
          const fileNames = yield* fs.readDirectory(directory)
          return yield* Effect.forEach(
            closure.packages,
            (packageName) => packedTarballOf(fileNames, packageName, directory),
          )
        })),
      Match.exhaustive,
    )
  })

const deriveBakeCacheKey = (
  environment: BakeEnvironment,
  packs: ReadonlyArray<PackedPackage>,
  fixtureIds: ReadonlyArray<string>,
  scratch: string,
  catalogs: WorkspaceCatalogs,
): Effect.Effect<string, ExitFailure | PlatformError | HarnessError, BakePlatform> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const crypto = yield* Crypto.Crypto
    const bakeScript = yield* fs.readFile(environment.bakeScriptPath)
    const packedTrees = yield* Effect.forEach(
      packs,
      (pack) =>
        Effect.gen(function*() {
          const target = path.join(scratch, 'unpacked', pack.fileName)
          yield* fs.makeDirectory(target, { recursive: true })
          yield* requireZeroExit(STEP_KEY, yield* runCommand(['tar', '-xzf', pack.tarballPath, '-C', target]))
          return { fileName: pack.fileName, files: yield* readTreeBytes(target) }
        }),
      { concurrency: 1 },
    )
    const fixtureTrees = yield* Effect.forEach(
      fixtureIds,
      (fixtureId) =>
        Effect.gen(function*() {
          const files = yield* readTreeBytes(path.join(environment.resourcesDir, fixtureId))
          return { fixtureId, files: yield* resolveTreeManifests(fixtureId, files, catalogs) }
        }),
      { concurrency: 1 },
    )
    return yield* bakeCacheKey(crypto, {
      baseImage: GuestJobs.BASE_IMAGE,
      bakeScript,
      packs: packedTrees,
      fixtures: fixtureTrees,
    })
  })

const bake = (environment: BakeEnvironment) =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const crypto = yield* Crypto.Crypto
    const jobs = yield* GuestJobs
    const scratch = yield* fs.makeTempDirectory({ prefix: 'stryker-e2e-packs-' })
    const packsDir = path.join(scratch, 'packs')
    return yield* Effect.gen(function*() {
      yield* fs.makeDirectory(packsDir)
      const packs = yield* packWorkspaceClosure(environment, packsDir)
      const fixtureIds = yield* listFixtureIds(environment)
      const catalogs = yield* loadWorkspaceCatalogs(environment)
      const key = yield* deriveBakeCacheKey(environment, packs, fixtureIds, scratch, catalogs)
      const entryDir = path.join(environment.bakedCacheRoot, key)
      const entryExists = yield* fs.exists(entryDir)
      return yield* Boolean.match(entryExists, {
        onTrue: () => Effect.succeed(entryDir),
        onFalse: () =>
          Effect.gen(function*() {
            const stagingDir = `${entryDir}.staging-${yield* crypto.randomUUIDv4}`
            yield* Effect.gen(function*() {
              yield* fs.remove(stagingDir, { recursive: true, force: true })
              yield* fs.makeDirectory(stagingDir, { recursive: true })
              yield* stageFixtures(environment, stagingDir, fixtureIds, catalogs)
              const bakeScript = yield* fs.readFileString(environment.bakeScriptPath)
              yield* jobs.requireCleanExit(
                STEP_BAKE,
                jobs.job(['sh', '-c', bakeScript], [
                  { host: stagingDir, guest: GuestJobs.GUEST_BAKED_ROOT },
                  { host: packsDir, guest: GuestJobs.GUEST_PACKS_ROOT },
                ]),
              )
              yield* publishEntry(stagingDir, entryDir)
            }).pipe(Effect.ensuring(fs.remove(stagingDir, { recursive: true, force: true }).pipe(Effect.orDie)))
            yield* pruneOtherEntries(environment, key)
            return entryDir
          }),
      })
    }).pipe(Effect.ensuring(fs.remove(scratch, { recursive: true, force: true }).pipe(Effect.orDie)))
  })

const installFixtureInto = (
  scope: Scope.Scope,
  request: FixtureRequest,
): Effect.Effect<string, HarnessError, BakePlatform> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const jobs = yield* GuestJobs
    const hostFixtureDir = yield* path.fromFileUrl(request.url).pipe(Effect.orDie)
    const fixtureId = path.basename(hostFixtureDir)
    const stat = yield* Effect.option(fs.stat(hostFixtureDir))
    yield* Boolean.match(Option.exists(stat, (info) => info.type === 'Directory'), {
      onTrue: () => Effect.void,
      onFalse: () => Effect.fail(new FixtureMissingFailure({ directory: hostFixtureDir })),
    })
    const bakedRoot = yield* resolveBakedRoot
    const dir = yield* fs.makeTempDirectory({ prefix: `stryker-e2e-${request.name}-` })
    yield* Scope.addFinalizer(scope, fs.remove(dir, { recursive: true, force: true }).pipe(Effect.orDie))
    yield* jobs.requireCleanExit(
      `copy the baked ${fixtureId} fixture into the ${request.name} workspace`,
      jobs.job(['cp', '-a', `${GuestJobs.GUEST_BAKED_ROOT}/.`, `${GuestJobs.GUEST_WORKROOT}/`], [
        { host: path.join(bakedRoot, fixtureId), guest: GuestJobs.GUEST_BAKED_ROOT },
        { host: dir, guest: GuestJobs.GUEST_WORKROOT },
      ]),
    )
    return dir
  })

const cacheKeyOf = (request: FixtureRequest): string => `${request.name}\u0000${request.url.href}`

const requestOfCacheKey = (key: string): FixtureRequest => {
  const separator = key.indexOf('\u0000')
  return { name: key.slice(0, separator), url: new URL(key.slice(separator + 1)) }
}

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
  readonly install: (request: FixtureRequest) => Effect.Effect<string, HarnessError, BakePlatform>
  readonly readFile: (filePath: string) => Effect.Effect<string, PlatformError, FileSystem.FileSystem>
}

export class BakedFixtureCache extends Context.Service<BakedFixtureCache, BakedFixtureCacheShape>()(
  '@systemfsoftware/stryker-e2e/Harness/BakedFixtureCache',
) {
  static readonly BAKED_ROOT_ENV = 'STRYKER_E2E_BAKED_ROOT'

  static readonly bakeProgram: Effect.Effect<string, HarnessError, BakePlatform> = Effect.flatMap(bakeEnvironment, bake)

  static readonly layer = Layer.effect(
    BakedFixtureCache,
    Effect.gen(function*() {
      const scope = yield* Effect.scope
      const root = yield* Effect.cached(resolveBakedRoot)
      const installed = yield* Cache.make({
        capacity: 16,
        lookup: (key: string) => installFixtureInto(scope, requestOfCacheKey(key)),
        requireServicesAt: 'lookup',
      })
      return {
        root,
        install: (request: FixtureRequest) => Cache.get(installed, cacheKeyOf(request)),
        readFile: (filePath: string) => Effect.flatMap(FileSystem.FileSystem, (fs) => fs.readFileString(filePath)),
      }
    }),
  )
}

const resolveBakedRoot = Config.String(BakedFixtureCache.BAKED_ROOT_ENV)
