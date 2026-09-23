import { fileURLToPath } from 'node:url'

import { layer as nodeServicesLayer } from '@effect/platform-node/NodeServices'
import { MicroVM } from '@systemfsoftware/effect-microsandbox'
import { Cache, Config, Context, Crypto, Effect, FileSystem, Layer, Option, Path, Schema, Scope, Stream } from 'effect'
import type { PlatformError } from 'effect/PlatformError'
import { ChildProcess, ChildProcessSpawner } from 'effect/unstable/process'

import {
  bakeCacheKey,
  classifyJobExit,
  decodeUtf8,
  type FileBytes,
  guestTelemetryEnvironment,
  isInstallOutput,
  type PackedPackage,
  packedTarballOf,
  resolveTurboDryClosure,
  tailOf,
} from './bake-cache-key.js'

const REPO_ROOT = fileURLToPath(new URL('../../../..', import.meta.url))
const TEST_RESOURCES_DIR = fileURLToPath(new URL('../../testResources', import.meta.url))
const BAKE_SCRIPT_PATH = fileURLToPath(new URL('./bake-fixtures.sh', import.meta.url))
const BAKED_CACHE_ROOT = fileURLToPath(new URL('../../node_modules/.cache/stryker-e2e/baked', import.meta.url))

const BASE_IMAGE = 'node:24-alpine@sha256:333f6b3eca25980d5682c26207665b93c9417786b21760b2764d5821d9704c8a'
const GUEST_WORKROOT = '/work'
const GUEST_BAKED_ROOT = '/baked'
const GUEST_PACKS_ROOT = '/packs'
const GUEST_MEMORY_MIB = 4096

export const BAKED_ROOT_ENV = 'STRYKER_E2E_BAKED_ROOT'

const BAKE_STEP = 'bake every fixture in the preparation microVM'
const RUN_CLI_STEP = 'run the stryker CLI in its microVM'
const CLOSURE_STEP = 'build the packed workspace closure'
const TARBALLS_STEP = 'read the packed tarballs'
const KEY_STEP = 'derive the bake cache key'

const ENTRY_PACKAGES = [
  '@systemfsoftware/stryker-js',
  '@systemfsoftware/stryker-js-vitest-runner',
  '@systemfsoftware/stryker-js-typescript-checker',
] as const

export type ExecResult = {
  readonly exitCode: number
  readonly stdout: string
  readonly stderr: string
}

export type FixtureRequest = {
  readonly url: URL
  readonly name: string
}

type Argv = readonly [string, ...Array<string>]

type CommandOutcome = {
  readonly exitCode: number
  readonly stdout: string
  readonly stderr: string
}

type NodePlatform =
  | ChildProcessSpawner.ChildProcessSpawner
  | Crypto.Crypto
  | FileSystem.FileSystem
  | Path.Path

type TreeEntry = {
  readonly relativePath: string
  readonly kind: 'file' | 'directory'
}

export class GuestJobFailure extends Schema.TaggedError<GuestJobFailure>()('GuestJobFailure', {
  step: Schema.String,
  cause: Schema.Union([
    MicroVM.VirtualizationUnsupportedError,
    MicroVM.SandboxBootError,
    MicroVM.WaitTimeoutError,
    MicroVM.ExecError,
    MicroVM.PortAllocationError,
    MicroVM.LoopbackViolationError,
  ]),
}) {
  override get message(): string {
    switch (this.cause._tag) {
      case 'VirtualizationUnsupportedError':
        return `${this.step}: ${this.cause._tag} — ${this.cause.remediation}`
      case 'SandboxBootError':
        return `${this.step}: ${this.cause._tag} while booting sandbox ${this.cause.sandboxName}`
      case 'WaitTimeoutError':
        return `${this.step}: ${this.cause._tag} waiting for ${this.cause.wait} within ${this.cause.timeoutMs}ms`
      case 'ExecError':
        return `${this.step}: ${this.cause._tag} running ${this.cause.argv.join(' ')}`
      case 'PortAllocationError':
        return `${this.step}: ${this.cause._tag} for guest port ${this.cause.guestPort}`
      case 'LoopbackViolationError':
        return `${this.step}: ${this.cause._tag} mapping guest port ${this.cause.guestPort} on ${this.cause.host}`
    }
  }
}

export class GuestSignaledFailure extends Schema.TaggedError<GuestSignaledFailure>()('GuestSignaledFailure', {
  step: Schema.String,
  memoryMiB: Schema.Number,
  stderrTail: Schema.String,
}) {
  override get message(): string {
    return `${this.step}: the guest workload was killed by a signal instead of exiting; check the ${this.memoryMiB} MiB guest memory limit first\n${this.stderrTail}`
  }
}

export class ExitFailure extends Schema.TaggedError<ExitFailure>()('ExitFailure', {
  step: Schema.String,
  exitCode: Schema.Number,
  stderrTail: Schema.String,
}) {
  override get message(): string {
    return `${this.step}: exited ${this.exitCode}\n${this.stderrTail}`
  }
}

export class FixtureMissingFailure extends Schema.TaggedError<FixtureMissingFailure>()('FixtureMissingFailure', {
  directory: Schema.String,
}) {
  override get message(): string {
    return `fixture directory does not exist on the host: ${this.directory}`
  }
}

export class PackFailure extends Schema.TaggedError<PackFailure>()('PackFailure', {
  step: Schema.String,
  detail: Schema.String,
}) {
  override get message(): string {
    return `${this.step}: ${this.detail}`
  }
}

export type HarnessFailure =
  | ExitFailure
  | FixtureMissingFailure
  | GuestJobFailure
  | GuestSignaledFailure
  | PackFailure

type HarnessError = Config.ConfigError | HarnessFailure | PlatformError

const runCommand = (
  argv: Argv,
  cwd?: string,
): Effect.Effect<CommandOutcome, PlatformError, ChildProcessSpawner.ChildProcessSpawner> =>
  Effect.scoped(
    Effect.gen(function*() {
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
    }),
  )

const requireZeroExit = (step: string, outcome: CommandOutcome): Effect.Effect<CommandOutcome, ExitFailure> =>
  outcome.exitCode === 0
    ? Effect.succeed(outcome)
    : Effect.fail(new ExitFailure({ step, exitCode: outcome.exitCode, stderrTail: tailOf(outcome.stderr) }))

const runChecked = (
  step: string,
  argv: Argv,
  cwd?: string,
): Effect.Effect<CommandOutcome, ExitFailure | PlatformError, ChildProcessSpawner.ChildProcessSpawner> =>
  Effect.flatMap(runCommand(argv, cwd), (outcome) => requireZeroExit(step, outcome))

const guestJob = (
  cmd: Argv,
  mounts: ReadonlyArray<MicroVM.Mount>,
): MicroVM.JobResource =>
  mounts.reduce(
    (job, mount) => job.withMount(mount),
    MicroVM.job(BASE_IMAGE, cmd).withMemoryLimit(GUEST_MEMORY_MIB),
  )

const runGuestJob = (
  step: string,
  job: MicroVM.JobResource,
): Effect.Effect<MicroVM.JobCompletion, GuestJobFailure, Crypto.Crypto | FileSystem.FileSystem> =>
  Effect.scoped(job.run).pipe(
    Effect.mapError((cause) => new GuestJobFailure({ step, cause })),
  )

const requireExited = (
  step: string,
  completion: MicroVM.JobCompletion,
): Effect.Effect<number, GuestSignaledFailure> => {
  const verdict = classifyJobExit(completion)
  if (verdict._tag === 'Signaled') {
    return Effect.fail(
      new GuestSignaledFailure({
        step,
        memoryMiB: GUEST_MEMORY_MIB,
        stderrTail: tailOf(decodeUtf8(completion.stderr)),
      }),
    )
  }
  return Effect.succeed(verdict.code)
}

const requireCleanExit = (
  step: string,
  job: MicroVM.JobResource,
): Effect.Effect<void, ExitFailure | GuestJobFailure | GuestSignaledFailure, Crypto.Crypto | FileSystem.FileSystem> =>
  Effect.flatMap(
    runGuestJob(step, job),
    (completion) =>
      Effect.flatMap(requireExited(step, completion), (code) =>
        code === 0
          ? Effect.void
          : Effect.fail(new ExitFailure({ step, exitCode: code, stderrTail: tailOf(decodeUtf8(completion.stderr)) }))),
  )

const listTree = (
  root: string,
): Effect.Effect<ReadonlyArray<TreeEntry>, PlatformError, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const relativePaths = yield* fs.readDirectory(root, { recursive: true })
    const entries: Array<TreeEntry> = []
    for (const relativePath of relativePaths) {
      if (isInstallOutput(relativePath)) {
        continue
      }
      const info = yield* fs.stat(path.join(root, relativePath))
      if (info.type === 'File') {
        entries.push({ relativePath, kind: 'file' })
      } else if (info.type === 'Directory') {
        entries.push({ relativePath, kind: 'directory' })
      }
    }
    return entries.sort((left, right) => left.relativePath.localeCompare(right.relativePath))
  })

const readTreeBytes = (
  root: string,
): Effect.Effect<ReadonlyArray<FileBytes>, PlatformError, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const entries = yield* listTree(root)
    const files: Array<FileBytes> = []
    for (const entry of entries) {
      if (entry.kind !== 'file') {
        continue
      }
      files.push({
        relativePath: entry.relativePath,
        bytes: yield* fs.readFile(path.join(root, entry.relativePath)),
      })
    }
    return files
  })

const listFixtureIds = (): Effect.Effect<ReadonlyArray<string>, PlatformError, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const entries = yield* fs.readDirectory(TEST_RESOURCES_DIR)
    const ids: Array<string> = []
    for (const entry of entries) {
      if (yield* fs.exists(path.join(TEST_RESOURCES_DIR, entry, 'package.json'))) {
        ids.push(entry)
      }
    }
    return ids.sort()
  })

const stageFixtures = (
  stagingDir: string,
  fixtureIds: ReadonlyArray<string>,
): Effect.Effect<void, PlatformError, FileSystem.FileSystem | Path.Path> =>
  Effect.forEach(
    fixtureIds,
    (fixtureId) =>
      Effect.gen(function*() {
        const fs = yield* FileSystem.FileSystem
        const path = yield* Path.Path
        const destination = path.join(stagingDir, fixtureId)
        yield* fs.copy(path.join(TEST_RESOURCES_DIR, fixtureId), destination)
        yield* fs.remove(path.join(destination, 'node_modules'), { recursive: true, force: true })
      }),
    { discard: true },
  )

const publishEntry = (
  stagingDir: string,
  entryDir: string,
): Effect.Effect<void, PlatformError, FileSystem.FileSystem> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    yield* Effect.matchEffect(fs.rename(stagingDir, entryDir), {
      onSuccess: () => Effect.void,
      onFailure: (cause) =>
        Effect.gen(function*() {
          if (!(yield* fs.exists(entryDir))) {
            return yield* Effect.fail(cause)
          }
          yield* fs.remove(stagingDir, { recursive: true, force: true })
        }),
    })
  })

const pruneOtherEntries = (keep: string): Effect.Effect<void, PlatformError, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const entries = yield* fs.readDirectory(BAKED_CACHE_ROOT)
    const stale = entries.filter((name) => name !== keep && !name.includes('.staging-'))
    yield* Effect.forEach(
      stale,
      (name) => fs.remove(path.join(BAKED_CACHE_ROOT, name), { recursive: true, force: true }),
      { discard: true },
    )
  })

const deriveBakeCacheKey = (
  packs: ReadonlyArray<PackedPackage>,
  fixtureIds: ReadonlyArray<string>,
  scratch: string,
): Effect.Effect<
  string,
  ExitFailure | PlatformError,
  ChildProcessSpawner.ChildProcessSpawner | FileSystem.FileSystem | Path.Path
> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const bakeScript = yield* fs.readFile(BAKE_SCRIPT_PATH)
    const packedTrees = yield* Effect.forEach(packs, (pack) =>
      Effect.gen(function*() {
        const target = path.join(scratch, 'unpacked', pack.fileName)
        yield* fs.makeDirectory(target, { recursive: true })
        yield* requireZeroExit(KEY_STEP, yield* runCommand(['tar', '-xzf', pack.tarballPath, '-C', target]))
        return { fileName: pack.fileName, files: yield* readTreeBytes(target) }
      }))
    const fixtureTrees = yield* Effect.forEach(fixtureIds, (fixtureId) =>
      Effect.gen(function*() {
        return { fixtureId, files: yield* readTreeBytes(path.join(TEST_RESOURCES_DIR, fixtureId)) }
      }))
    return bakeCacheKey({ baseImage: BASE_IMAGE, bakeScript, packs: packedTrees, fixtures: fixtureTrees })
  })

const packWorkspaceClosure = (
  directory: string,
): Effect.Effect<
  ReadonlyArray<PackedPackage>,
  ExitFailure | PackFailure | PlatformError,
  ChildProcessSpawner.ChildProcessSpawner | FileSystem.FileSystem | Path.Path
> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const dryRun = yield* runChecked(
      CLOSURE_STEP,
      ['pnpm', 'exec', 'turbo', 'run', 'build', ...ENTRY_PACKAGES.map((entry) => `--filter=${entry}`), '--dry=json'],
      REPO_ROOT,
    )
    const resolved = resolveTurboDryClosure(dryRun.stdout)
    if (resolved._tag === 'Malformed') {
      return yield* Effect.fail(
        new PackFailure({ step: CLOSURE_STEP, detail: 'the turbo dry run wrote no parseable closure document' }),
      )
    }
    const closure = resolved.packages
    yield* runChecked(
      CLOSURE_STEP,
      ['pnpm', 'exec', 'turbo', 'run', 'build', ...closure.map((packageName) => `--filter=${packageName}`)],
      REPO_ROOT,
    )
    yield* Effect.forEach(
      closure,
      (packageName) =>
        runChecked(`pack ${packageName}`, [
          'pnpm',
          '--filter',
          packageName,
          'pack',
          '--pack-destination',
          directory,
        ], REPO_ROOT),
      { discard: true },
    )
    const fileNames = yield* fs.readDirectory(directory)
    return yield* Effect.forEach(closure, (packageName) => {
      const lookup = packedTarballOf(fileNames, packageName, directory)
      switch (lookup._tag) {
        case 'Found':
          return Effect.succeed(lookup.pack)
        case 'MissingTarball':
          return Effect.fail(
            new PackFailure({
              step: TARBALLS_STEP,
              detail: `pnpm pack wrote no ${lookup.prefix}*.tgz into ${lookup.directory}`,
            }),
          )
        case 'UnreadableVersion':
          return Effect.fail(
            new PackFailure({
              step: TARBALLS_STEP,
              detail: `the packed tarball ${lookup.fileName} carries no parseable version`,
            }),
          )
      }
    })
  })

export const bakeFixtureCache: Effect.Effect<string, HarnessError, NodePlatform> = Effect.gen(
  function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const scratch = yield* fs.makeTempDirectory({ prefix: 'stryker-e2e-packs-' })
    const packsDir = path.join(scratch, 'packs')
    return yield* Effect.gen(function*() {
      yield* fs.makeDirectory(packsDir)
      const packs = yield* packWorkspaceClosure(packsDir)
      const fixtureIds = yield* listFixtureIds()
      const key = yield* deriveBakeCacheKey(packs, fixtureIds, scratch)
      const entryDir = path.join(BAKED_CACHE_ROOT, key)
      if (yield* fs.exists(entryDir)) {
        return entryDir
      }
      const pid = yield* Effect.sync(() => process.pid)
      const stagingDir = `${entryDir}.staging-${pid}`
      yield* Effect.gen(function*() {
        yield* fs.remove(stagingDir, { recursive: true, force: true })
        yield* fs.makeDirectory(stagingDir, { recursive: true })
        yield* stageFixtures(stagingDir, fixtureIds)
        const bakeScript = yield* fs.readFileString(BAKE_SCRIPT_PATH)
        yield* requireCleanExit(
          BAKE_STEP,
          guestJob(['sh', '-c', bakeScript], [
            { host: stagingDir, guest: GUEST_BAKED_ROOT },
            { host: packsDir, guest: GUEST_PACKS_ROOT },
          ]),
        )
        yield* publishEntry(stagingDir, entryDir)
      }).pipe(Effect.ensuring(fs.remove(stagingDir, { recursive: true, force: true }).pipe(Effect.orDie)))
      yield* pruneOtherEntries(key)
      return entryDir
    }).pipe(Effect.ensuring(fs.remove(scratch, { recursive: true, force: true }).pipe(Effect.orDie)))
  },
)

const resolveBakedRoot: Effect.Effect<string, HarnessError, NodePlatform> = Effect.gen(function*() {
  const provided = yield* Config.option(Config.String(BAKED_ROOT_ENV))
  if (Option.isSome(provided)) {
    return provided.value
  }
  return yield* bakeFixtureCache
})

const readWorkspaceFile = (filePath: string): Effect.Effect<string, PlatformError, FileSystem.FileSystem> =>
  Effect.flatMap(FileSystem.FileSystem, (fs) => fs.readFileString(filePath))

const installFixtureInto = (
  request: FixtureRequest,
): Effect.Effect<
  string,
  HarnessError,
  ChildProcessSpawner.ChildProcessSpawner | Crypto.Crypto | FileSystem.FileSystem | Path.Path | Scope.Scope
> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const scope = yield* Scope.Scope
    const hostFixtureDir = fileURLToPath(request.url)
    const fixtureId = path.basename(hostFixtureDir)
    const stat = yield* Effect.option(fs.stat(hostFixtureDir))
    if (Option.isNone(stat) || stat.value.type !== 'Directory') {
      return yield* Effect.fail(new FixtureMissingFailure({ directory: hostFixtureDir }))
    }
    const bakedRoot = yield* resolveBakedRoot
    const dir = yield* fs.makeTempDirectory({ prefix: `stryker-e2e-${request.name}-` })
    yield* Scope.addFinalizer(scope, fs.remove(dir, { recursive: true, force: true }).pipe(Effect.orDie))
    yield* requireCleanExit(
      `copy the baked ${fixtureId} fixture into the ${request.name} workspace`,
      guestJob(['cp', '-a', `${GUEST_BAKED_ROOT}/.`, `${GUEST_WORKROOT}/`], [
        { host: path.join(bakedRoot, fixtureId), guest: GUEST_BAKED_ROOT },
        { host: dir, guest: GUEST_WORKROOT },
      ]),
    )
    return dir
  })

const cacheKeyOf = (request: FixtureRequest): string => `${request.name}\u0000${request.url.href}`

const requestOfCacheKey = (key: string): FixtureRequest => {
  const separator = key.indexOf('\u0000')
  return { name: key.slice(0, separator), url: new URL(key.slice(separator + 1)) }
}

const runStrykerCli = (
  args: ReadonlyArray<string>,
  cwd: string,
): Effect.Effect<ExecResult, HarnessError, Crypto.Crypto | FileSystem.FileSystem> =>
  Effect.gen(function*() {
    const enabled = yield* Config.option(Config.String('OTEL_ENABLED'))
    const service = yield* Config.option(Config.String('OTEL_SERVICE_NAME'))
    const endpoint = yield* Config.option(Config.String('OTEL_EXPORTER_OTLP_ENDPOINT'))
    const completion = yield* runGuestJob(
      RUN_CLI_STEP,
      guestJob(['npx', '--no-install', 'stryker', ...args], [{ host: cwd, guest: GUEST_WORKROOT }])
        .withWorkdir(GUEST_WORKROOT)
        .withEnv(
          guestTelemetryEnvironment({
            OTEL_ENABLED: Option.getOrUndefined(enabled),
            OTEL_SERVICE_NAME: Option.getOrUndefined(service),
            OTEL_EXPORTER_OTLP_ENDPOINT: Option.getOrUndefined(endpoint),
          }),
        )
        .withHostAccess(true),
    )
    const exitCode = yield* requireExited(RUN_CLI_STEP, completion)
    return { exitCode, stdout: decodeUtf8(completion.stdout), stderr: decodeUtf8(completion.stderr) }
  })

export interface BakedFixtureCacheService {
  readonly root: Effect.Effect<string, HarnessError>
  readonly install: (request: FixtureRequest) => Effect.Effect<string, HarnessError>
  readonly readFile: (filePath: string) => Effect.Effect<string, PlatformError>
}

export interface StrykerCliRunnerService {
  readonly run: (args: ReadonlyArray<string>, cwd: string) => Effect.Effect<ExecResult, HarnessError>
}

export const BakedFixtureCache = Context.Service<BakedFixtureCacheService>('BakedFixtureCache')
export const StrykerCliRunner = Context.Service<StrykerCliRunnerService>('StrykerCliRunner')

const bakedFixtureCacheLayer: Layer.Layer<BakedFixtureCacheService, never, NodePlatform> = Layer.effect(
  BakedFixtureCache,
  Effect.gen(function*() {
    const crypto = yield* Crypto.Crypto
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
    const scope = yield* Effect.scope
    const platform = Context.make(Crypto.Crypto, crypto).pipe(
      Context.add(FileSystem.FileSystem, fs),
      Context.add(Path.Path, path),
      Context.add(ChildProcessSpawner.ChildProcessSpawner, spawner),
      Context.add(Scope.Scope, scope),
    )
    const root = yield* Effect.cached(resolveBakedRoot)
    const installed = yield* Cache.make<string, string, HarnessError, NodePlatform | Scope.Scope>({
      capacity: 16,
      lookup: (key) => installFixtureInto(requestOfCacheKey(key)),
    })
    return {
      root: root.pipe(Effect.provide(platform)),
      install: (request: FixtureRequest) => Cache.get(installed, cacheKeyOf(request)).pipe(Effect.provide(platform)),
      readFile: (filePath: string) => readWorkspaceFile(filePath).pipe(Effect.provide(platform)),
    }
  }),
)

const strykerCliRunnerLayer: Layer.Layer<StrykerCliRunnerService, never, NodePlatform> = Layer.effect(
  StrykerCliRunner,
  Effect.gen(function*() {
    const crypto = yield* Crypto.Crypto
    const fs = yield* FileSystem.FileSystem
    const platform = Context.make(Crypto.Crypto, crypto).pipe(Context.add(FileSystem.FileSystem, fs))
    return {
      run: (args: ReadonlyArray<string>, cwd: string) => runStrykerCli(args, cwd).pipe(Effect.provide(platform)),
    }
  }),
)

export const HarnessLive: Layer.Layer<BakedFixtureCacheService | StrykerCliRunnerService> = Layer.mergeAll(
  bakedFixtureCacheLayer,
  strykerCliRunnerLayer,
).pipe(Layer.provide(nodeServicesLayer))

export const installFixture = (
  request: FixtureRequest,
): Effect.Effect<string, HarnessError, BakedFixtureCacheService> =>
  BakedFixtureCache.use((cache) => cache.install(request))

export const runCli = (
  args: ReadonlyArray<string>,
  cwd: string,
): Effect.Effect<ExecResult, HarnessError, StrykerCliRunnerService> =>
  StrykerCliRunner.use((runner) => runner.run(args, cwd))
