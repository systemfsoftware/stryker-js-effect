import { execFile } from 'node:child_process'
import { createHash, type Hash } from 'node:crypto'
import { cp, mkdir, mkdtemp, readdir, readFile, rename, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

import { layer as nodeServicesLayer } from '@effect/platform-node/NodeServices'
import { MicroVM } from '@systemfsoftware/effect-microsandbox'
import { Cause, Effect, Exit } from 'effect'

const execFileAsync = promisify(execFile)

const REPO_ROOT = fileURLToPath(new URL('../../../..', import.meta.url))
const TEST_RESOURCES_DIR = fileURLToPath(new URL('../../testResources', import.meta.url))
const BAKE_SCRIPT_PATH = fileURLToPath(new URL('./bake-fixtures.sh', import.meta.url))
const BAKED_CACHE_ROOT = fileURLToPath(new URL('../../node_modules/.cache/stryker-e2e/baked', import.meta.url))

const BASE_IMAGE = 'node:24-alpine@sha256:333f6b3eca25980d5682c26207665b93c9417786b21760b2764d5821d9704c8a'
const GUEST_WORKROOT = '/work'
const GUEST_BAKED_ROOT = '/baked'
const GUEST_PACKS_ROOT = '/packs'
const GUEST_MEMORY_MIB = 4096
const GUEST_HOST_ALIAS = 'host.microsandbox.internal'

const BAKED_ROOT_ENV = 'STRYKER_E2E_BAKED_ROOT'

const ENTRY_PACKAGES = [
  '@systemfsoftware/stryker-js',
  '@systemfsoftware/stryker-js-vitest-runner',
  '@systemfsoftware/stryker-js-typescript-checker',
] as const

const PACKED_TARBALL_VERSION = /-(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\.tgz$/

const STDERR_TAIL_CHARS = 4000

export type ExecResult = {
  readonly exitCode: number
  readonly stdout: string
  readonly stderr: string
}

type PackedPackage = {
  readonly name: string
  readonly version: string
  readonly fileName: string
  readonly tarballPath: string
}

let ready: Promise<string> | undefined

const installedFixtures = new Map<string, Promise<string>>()
const workspaceDirs = new Set<string>()

const messageOf = (cause: unknown): string => {
  if (cause instanceof Error) {
    return cause.message
  }
  if (typeof cause === 'string') {
    return cause
  }
  return 'unknown failure'
}

export async function requireStep<T>(step: string, operation: () => Promise<T>): Promise<T> {
  try {
    return await operation()
  } catch (cause) {
    throw new Error(`${step}: ${messageOf(cause)}`, { cause })
  }
}

const decodeUtf8 = (bytes: Uint8Array): string => new TextDecoder().decode(bytes)

const tailOf = (text: string): string => text.slice(-STDERR_TAIL_CHARS)

const describeFailure = (cause: Cause.Cause<unknown>): string => {
  if (Cause.hasInterruptsOnly(cause)) {
    return 'interrupted before the workload exited'
  }
  const failure = Cause.squash(cause)
  if (typeof failure === 'object' && failure !== null && '_tag' in failure && typeof failure._tag === 'string') {
    const remediation = 'remediation' in failure && typeof failure.remediation === 'string'
      ? ` — ${failure.remediation}`
      : ''
    return `${failure._tag}${remediation}: ${messageOf(failure)}`
  }
  return messageOf(failure)
}

const runJob = async (
  step: string,
  job: MicroVM.JobResource,
  signal?: AbortSignal,
): Promise<MicroVM.JobCompletion> => {
  const exit = await Effect.runPromiseExit(
    Effect.scoped(job.run).pipe(Effect.provide(nodeServicesLayer)),
    signal === undefined ? undefined : { signal },
  )
  if (Exit.isSuccess(exit)) {
    return exit.value
  }
  throw new Error(`${step}: ${describeFailure(exit.cause)}`, { cause: Cause.squash(exit.cause) })
}

const exitCodeOf = (step: string, completion: MicroVM.JobCompletion): number => {
  const status = completion.status
  switch (status._tag) {
    case 'JobExited':
      return status.code
    case 'JobSignaled':
      throw new Error(
        `${step}: the guest workload was killed by a signal instead of exiting; check the ${GUEST_MEMORY_MIB} MiB guest memory limit first\n${
          tailOf(decodeUtf8(completion.stderr))
        }`,
      )
  }
}

const guestJob = (
  cmd: readonly [string, ...Array<string>],
  mounts: ReadonlyArray<MicroVM.Mount>,
): MicroVM.JobResource =>
  mounts.reduce(
    (job, mount) => job.withMount(mount),
    MicroVM.job(BASE_IMAGE, cmd).withMemoryLimit(GUEST_MEMORY_MIB),
  )

const requireCleanExit = async (step: string, job: MicroVM.JobResource): Promise<void> => {
  const completion = await runJob(step, job)
  const exitCode = exitCodeOf(step, completion)
  if (exitCode !== 0) {
    throw new Error(`${step}: exited ${exitCode}\n${tailOf(decodeUtf8(completion.stderr))}`)
  }
}

const packedTarballOf = (fileNames: readonly string[], packageName: string, directory: string): PackedPackage => {
  const prefix = `${packageName.slice(1).replace('/', '-')}-`
  const fileName = fileNames.find((candidate) => candidate.startsWith(prefix) && candidate.endsWith('.tgz'))
  if (fileName === undefined) {
    throw new Error(`pnpm pack wrote no ${prefix}*.tgz into ${directory}`)
  }
  const version = PACKED_TARBALL_VERSION.exec(fileName)?.[1]
  if (version === undefined) {
    throw new Error(`the packed tarball ${fileName} carries no parseable version`)
  }
  return { name: packageName, version, fileName, tarballPath: join(directory, fileName) }
}

const resolvePackableClosureFromTurbo = async (): Promise<ReadonlyArray<string>> => {
  const turboDry = await execFileAsync(
    'pnpm',
    [
      'exec',
      'turbo',
      'run',
      'build',
      ...ENTRY_PACKAGES.map((pkg) => `--filter=${pkg}`),
      '--dry=json',
    ],
    { cwd: REPO_ROOT },
  )
  const jsonStart = turboDry.stdout.indexOf('{')
  const parsed = JSON.parse(turboDry.stdout.slice(jsonStart)) as {
    readonly tasks: ReadonlyArray<{ readonly taskId: string; readonly package?: string; readonly command?: string }>
  }
  const packages = new Set<string>()
  for (const task of parsed.tasks) {
    if ((task.command === 'build' || task.taskId.endsWith('#build')) && task.package) {
      packages.add(task.package)
    }
  }
  return [...packages].sort()
}

const packWorkspaceClosure = async (directory: string): Promise<ReadonlyArray<PackedPackage>> => {
  const closure = await resolvePackableClosureFromTurbo()
  await requireStep('build the packed workspace closure', () =>
    execFileAsync(
      'pnpm',
      ['exec', 'turbo', 'run', 'build', ...closure.map((packageName) => `--filter=${packageName}`)],
      { cwd: REPO_ROOT },
    ))
  for (const packageName of closure) {
    await requireStep(
      `pack ${packageName}`,
      () =>
        execFileAsync('pnpm', ['--filter', packageName, 'pack', '--pack-destination', directory], { cwd: REPO_ROOT }),
    )
  }
  const fileNames = await requireStep('read the packed tarballs', () => readdir(directory))
  return closure.map((packageName) => packedTarballOf(fileNames, packageName, directory))
}

const isInstallOutput = (relativePath: string): boolean => relativePath.split('/').includes('node_modules')

const listFixtureIds = async (): Promise<ReadonlyArray<string>> => {
  const ids: string[] = []
  for (const entry of await readdir(TEST_RESOURCES_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue
    }
    const manifest = await stat(join(TEST_RESOURCES_DIR, entry.name, 'package.json')).catch(() => undefined)
    if (manifest !== undefined) {
      ids.push(entry.name)
    }
  }
  return ids.sort()
}

const listFilesUnder = async (root: string): Promise<ReadonlyArray<string>> => {
  const entries = await readdir(root, { recursive: true, withFileTypes: true })
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name).slice(root.length + 1))
    .filter((relativePath) => !isInstallOutput(relativePath))
    .sort()
}

const canonicalJson = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(canonicalJson)
  }
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalJson(entry)]),
    )
  }
  return value
}

const contentOf = async (path: string): Promise<Buffer | string> =>
  basename(path) === 'package.json'
    ? JSON.stringify(canonicalJson(JSON.parse(await readFile(path, 'utf8'))))
    : readFile(path)

const hashTree = async (hash: Hash, label: string, root: string): Promise<void> => {
  for (const relativePath of await listFilesUnder(root)) {
    hash.update(`${label}\0${relativePath}\0`).update(await contentOf(join(root, relativePath))).update('\0')
  }
}

const unpackTarball = async (pack: PackedPackage, directory: string): Promise<string> => {
  const target = join(directory, 'unpacked', pack.fileName)
  await mkdir(target, { recursive: true })
  await execFileAsync('tar', ['-xzf', pack.tarballPath, '-C', target])
  return target
}

const bakeKeyOf = async (
  packs: ReadonlyArray<PackedPackage>,
  fixtureIds: ReadonlyArray<string>,
  scratch: string,
): Promise<string> => {
  const hash = createHash('sha256')
  hash.update(`image\0${BASE_IMAGE}\0`)
  hash.update(`bake\0`).update(await readFile(BAKE_SCRIPT_PATH)).update('\0')
  for (const pack of [...packs].sort((left, right) => left.name.localeCompare(right.name))) {
    await hashTree(hash, `pack\0${pack.fileName}`, await unpackTarball(pack, scratch))
  }
  for (const fixtureId of fixtureIds) {
    await hashTree(hash, `fixture\0${fixtureId}`, join(TEST_RESOURCES_DIR, fixtureId))
  }
  return hash.digest('hex')
}

const stageFixtures = async (stagingDir: string, fixtureIds: ReadonlyArray<string>): Promise<void> => {
  for (const fixtureId of fixtureIds) {
    const source = join(TEST_RESOURCES_DIR, fixtureId)
    await requireStep(
      `stage the ${fixtureId} fixture for the bake`,
      () =>
        cp(source, join(stagingDir, fixtureId), {
          recursive: true,
          filter: (path) => !isInstallOutput(path.slice(source.length)),
        }),
    )
  }
}

const isRenameCollision = (cause: unknown): boolean =>
  cause instanceof Error && 'code' in cause && (cause.code === 'ENOTEMPTY' || cause.code === 'EEXIST')

const publishEntry = async (stagingDir: string, entryDir: string): Promise<void> => {
  try {
    await rename(stagingDir, entryDir)
  } catch (cause) {
    if (!isRenameCollision(cause)) {
      throw cause
    }
    await rm(stagingDir, { recursive: true, force: true })
  }
}

const pruneOtherEntries = async (keep: string): Promise<void> => {
  const stale = (await readdir(BAKED_CACHE_ROOT, { withFileTypes: true })).filter(
    (entry) => entry.isDirectory() && entry.name !== keep && !entry.name.includes('.staging-'),
  )
  await Promise.all(stale.map((entry) => rm(join(BAKED_CACHE_ROOT, entry.name), { recursive: true, force: true })))
}

const bakeFixtureCache = async (): Promise<string> => {
  const scratch = await requireStep(
    'create the pack scratch directory',
    () => mkdtemp(join(tmpdir(), 'stryker-e2e-packs-')),
  )
  const packsDir = join(scratch, 'packs')
  try {
    await mkdir(packsDir)
    const packs = await packWorkspaceClosure(packsDir)
    const fixtureIds = await listFixtureIds()
    const key = await requireStep('derive the bake cache key', () => bakeKeyOf(packs, fixtureIds, scratch))
    const entryDir = join(BAKED_CACHE_ROOT, key)
    if ((await stat(entryDir).catch(() => undefined)) !== undefined) {
      return entryDir
    }
    const stagingDir = `${entryDir}.staging-${process.pid}`
    await rm(stagingDir, { recursive: true, force: true })
    await mkdir(stagingDir, { recursive: true })
    try {
      await stageFixtures(stagingDir, fixtureIds)
      const bakeScript = await readFile(BAKE_SCRIPT_PATH, 'utf8')
      await requireCleanExit(
        'bake every fixture in the preparation microVM',
        guestJob(['sh', '-c', bakeScript], [
          { host: stagingDir, guest: GUEST_BAKED_ROOT },
          { host: packsDir, guest: GUEST_PACKS_ROOT },
        ]),
      )
      await requireStep('publish the baked fixture cache entry', () => publishEntry(stagingDir, entryDir))
    } finally {
      await rm(stagingDir, { recursive: true, force: true })
    }
    await pruneOtherEntries(key)
    return entryDir
  } finally {
    await rm(scratch, { recursive: true, force: true })
  }
}

const resolveBakedRoot = async (): Promise<string> => {
  const provided = process.env[BAKED_ROOT_ENV]
  if (provided !== undefined && provided !== '') {
    return provided
  }
  const bakedRoot = await bakeFixtureCache()
  process.env[BAKED_ROOT_ENV] = bakedRoot
  return bakedRoot
}

export const ensureMicroVMEnvironment = async (): Promise<string> => {
  ready ??= resolveBakedRoot()
  return ready
}

export const teardownMicroVMEnvironment = async (): Promise<void> => {
  installedFixtures.clear()
  const dirs = [...workspaceDirs]
  workspaceDirs.clear()
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })))
}

const guestTelemetryEnvironment = (): Record<string, string> => ({
  OTEL_ENABLED: process.env['OTEL_ENABLED'] ?? 'false',
  OTEL_SERVICE_NAME: process.env['OTEL_SERVICE_NAME'] ?? 'stryker-e2e',
  OTEL_EXPORTER_OTLP_ENDPOINT: (process.env['OTEL_EXPORTER_OTLP_ENDPOINT'] ?? 'http://127.0.0.1:4318')
    .replace('127.0.0.1', GUEST_HOST_ALIAS)
    .replace('localhost', GUEST_HOST_ALIAS),
})

export async function runCli(
  args: readonly string[],
  opts: { readonly cwd: string; readonly signal?: AbortSignal },
): Promise<ExecResult> {
  if (!workspaceDirs.has(opts.cwd)) {
    throw new Error(`cwd ${opts.cwd} is not a workspace created by installFixture`)
  }
  const step = 'run the stryker CLI in its microVM'
  const job = guestJob(['npx', '--no-install', 'stryker', ...args], [{ host: opts.cwd, guest: GUEST_WORKROOT }])
    .withWorkdir(GUEST_WORKROOT)
    .withEnv(guestTelemetryEnvironment())
    .withHostAccess(true)
  const completion = await runJob(step, job, opts.signal)
  return {
    exitCode: exitCodeOf(step, completion),
    stdout: decodeUtf8(completion.stdout),
    stderr: decodeUtf8(completion.stderr),
  }
}

export async function readWorkspaceFile(path: string): Promise<string> {
  return readFile(path, 'utf8')
}

export function installFixture(fixtureUrl: URL, name: string): Promise<string> {
  const cached = installedFixtures.get(name)
  if (cached !== undefined) {
    return cached
  }
  const task = (async () => {
    const hostFixtureDir = fileURLToPath(fixtureUrl)
    const fixtureId = basename(hostFixtureDir)
    await requireStep(`verify the ${name} fixture exists on the host`, async () => {
      const st = await stat(hostFixtureDir).catch(() => undefined)
      if (st === undefined || !st.isDirectory()) {
        throw new Error(`fixture directory does not exist on the host: ${hostFixtureDir}`)
      }
    })
    const bakedRoot = await ensureMicroVMEnvironment()
    const dir = await requireStep(
      `create the ${name} workspace directory`,
      () => mkdtemp(join(tmpdir(), `stryker-e2e-${name}-`)),
    )
    workspaceDirs.add(dir)
    await requireCleanExit(
      `copy the baked ${fixtureId} fixture into the ${name} workspace`,
      guestJob(['cp', '-a', `${GUEST_BAKED_ROOT}/.`, `${GUEST_WORKROOT}/`], [
        { host: join(bakedRoot, fixtureId), guest: GUEST_BAKED_ROOT },
        { host: dir, guest: GUEST_WORKROOT },
      ]),
    )
    return dir
  })()
  installedFixtures.set(name, task)
  return task
}
