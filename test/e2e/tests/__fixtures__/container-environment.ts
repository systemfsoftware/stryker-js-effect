import { execFile, spawn } from 'node:child_process'
import { createHash, type Hash } from 'node:crypto'
import { copyFile, cp, mkdir, mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

import { readPackableWorkspaceManifests, resolveWorkspaceClosure } from './closure-resolver.js'

const execFileAsync = promisify(execFile)

export const CONTAINER_WORKROOT = '/work'

const NODE_IMAGE = 'node:24-alpine@sha256:333f6b3eca25980d5682c26207665b93c9417786b21760b2764d5821d9704c8a'

const REPO_ROOT = fileURLToPath(new URL('../../../..', import.meta.url))
const TEST_RESOURCES_DIR = fileURLToPath(new URL('../../testResources', import.meta.url))
const IMAGE_ASSETS_DIR = fileURLToPath(new URL('./image', import.meta.url))

export const CLI_PACKAGE = '@systemfsoftware/stryker-js'

export const TYPESCRIPT_CHECKER_PACKAGE = '@systemfsoftware/stryker-js-typescript-checker'

const PLUGIN_PACKAGES = [
  '@systemfsoftware/stryker-js-vitest-runner',
  TYPESCRIPT_CHECKER_PACKAGE,
] as const

export const ENTRY_PACKAGES = [CLI_PACKAGE, ...PLUGIN_PACKAGES]

const PACKED_TARBALL_VERSION = /-(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\.tgz$/

const VITEST_RUNNER_PACKAGE = PLUGIN_PACKAGES[0]

const HOST_NETWORK_MODE = 'host'

const SKEW_CHECKER_PACKAGE = '@systemfsoftware/stryker-js-effect-skew-checker'

export const SKEW_EFFECT_VERSION = '4.0.0-rc.115'

const SKEW_CHECKER_DIRECTORY = join(TEST_RESOURCES_DIR, 'effect-skew-checker')

const NON_FIXTURE_RESOURCE_DIRS: Record<string, true> = { 'effect-skew-checker': true }

const IMAGE_TAG_PREFIX = 'stryker-js-effect-e2e'

let probedRuntime: Promise<string> | undefined

const runtimeBinary = (): Promise<string> => {
  const override = process.env['RUNTIME']
  if (override !== undefined && override !== '') {
    return Promise.resolve(override)
  }
  probedRuntime ??= (async () => {
    for (const candidate of ['podman', 'docker']) {
      const probe = await runProcess(candidate, ['--version']).catch(() => undefined)
      if (probe?.exitCode === 0) {
        return candidate
      }
    }
    throw new Error('no container runtime on PATH (looked for podman, docker); set RUNTIME')
  })()
  return probedRuntime
}

const CONTAINER_TELEMETRY_ENVIRONMENT = {
  OTEL_ENABLED: process.env['OTEL_ENABLED'] ?? 'false',
  OTEL_SERVICE_NAME: process.env['OTEL_SERVICE_NAME'] ?? 'stryker-e2e',
  OTEL_EXPORTER_OTLP_ENDPOINT: process.env['OTEL_EXPORTER_OTLP_ENDPOINT'] ?? 'http://127.0.0.1:4318',
}

const workspacePackageDirectory = (packageName: string): string =>
  join(REPO_ROOT, 'packages', packageName.slice('@systemfsoftware/'.length))

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

let scratch: string | undefined
let imageTag: string | undefined
let ready: Promise<void> | undefined
let hostNetworking = false

const installedFixtures = new Map<string, Promise<string>>()
const workspacesByDir = new Map<string, string>()
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

const packWorkspaceClosure = async (directory: string): Promise<Readonly<Record<string, PackedPackage>>> => {
  const closure = resolveWorkspaceClosure(await readPackableWorkspaceManifests(REPO_ROOT), ENTRY_PACKAGES)
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
  return Object.fromEntries(
    closure.map((packageName) => [packageName, packedTarballOf(fileNames, packageName, directory)]),
  )
}

const buildSkewCheckerBundle = async (directory: string): Promise<string> => {
  const skewedEffectDirectory = join(directory, 'skew-effect')
  await requireStep(`fetch effect@${SKEW_EFFECT_VERSION} for the skew bundle`, () =>
    execFileAsync(
      'npm',
      [
        'install',
        '--prefix',
        skewedEffectDirectory,
        '--no-save',
        '--no-package-lock',
        '--silent',
        `effect@${SKEW_EFFECT_VERSION}`,
      ],
      { cwd: directory },
    ))
  const bundledDirectory = join(directory, 'skew-checker-dist')
  await requireStep('bundle the effect-skew checker worker', () =>
    execFileAsync(
      'pnpm',
      [
        '--filter',
        VITEST_RUNNER_PACKAGE,
        'exec',
        'tsdown',
        '--config',
        join(SKEW_CHECKER_DIRECTORY, 'tsdown.config.mjs'),
      ],
      {
        cwd: REPO_ROOT,
        env: {
          ...process.env,
          SKEW_EFFECT_DIR: join(skewedEffectDirectory, 'node_modules', 'effect'),
          SKEW_RUNNER_MANIFEST: join(workspacePackageDirectory(VITEST_RUNNER_PACKAGE), 'package.json'),
          SKEW_OUT_DIR: bundledDirectory,
        },
      },
    ))
  return bundledDirectory
}

const stageSkewCheckerPackage = async (directory: string, bundledDirectory: string): Promise<string> => {
  const packageDirectory = join(directory, 'skew-checker-package')
  const distDirectory = join(packageDirectory, 'dist')
  await requireStep('stage the effect-skew checker package', async () => {
    await mkdir(distDirectory, { recursive: true })
    await copyFile(join(SKEW_CHECKER_DIRECTORY, 'package.json'), join(packageDirectory, 'package.json'))
    for (const fileName of await readdir(bundledDirectory)) {
      await copyFile(join(bundledDirectory, fileName), join(distDirectory, fileName))
    }
  })
  return packageDirectory
}

const packSkewChecker = async (directory: string, destination: string): Promise<PackedPackage> => {
  const bundledDirectory = await buildSkewCheckerBundle(directory)
  const packageDirectory = await stageSkewCheckerPackage(directory, bundledDirectory)
  await mkdir(destination, { recursive: true })
  await requireStep(
    'pack the effect-skew checker',
    () => execFileAsync('npm', ['pack', packageDirectory, '--pack-destination', destination], { cwd: directory }),
  )
  const fileNames = await requireStep('read the packed effect-skew checker', () => readdir(destination))
  return packedTarballOf(fileNames, SKEW_CHECKER_PACKAGE, destination)
}

const copyFixturesIntoContext = async (contextDir: string): Promise<void> => {
  const fixturesDir = join(contextDir, 'fixtures')
  await mkdir(fixturesDir, { recursive: true })
  for (const entry of await readdir(TEST_RESOURCES_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory() || NON_FIXTURE_RESOURCE_DIRS[entry.name] === true) {
      continue
    }
    const source = join(TEST_RESOURCES_DIR, entry.name)
    const st = await stat(join(source, 'package.json')).catch(() => undefined)
    if (st === undefined) {
      continue
    }
    await requireStep(
      `copy the ${entry.name} fixture into the image context`,
      () => cp(source, join(fixturesDir, entry.name), { recursive: true }),
    )
  }
}

const HASH_SKIP: Record<string, true> = {
  '.stryker-tmp': true,
  dist: true,
  node_modules: true,
  reports: true,
}

const hashDirectory = async (hash: Hash, root: string, relative: string): Promise<void> => {
  const entries = await readdir(join(root, relative), { withFileTypes: true })
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (HASH_SKIP[entry.name] === true) continue
    const entryRelative = relative === '' ? entry.name : `${relative}/${entry.name}`
    if (entry.isDirectory()) {
      await hashDirectory(hash, root, entryRelative)
    } else if (entry.isFile()) {
      hash.update(entryRelative)
      hash.update(await readFile(join(root, entryRelative)))
    }
  }
}

const hashIfPresent = async (hash: Hash, root: string, relative: string): Promise<void> => {
  const info = await stat(join(root, relative)).catch(() => undefined)
  if (info === undefined) return
  if (info.isDirectory()) {
    hash.update(relative)
    await hashDirectory(hash, root, relative)
    return
  }
  hash.update(relative)
  hash.update(await readFile(join(root, relative)))
}

const fingerprintTag = async (): Promise<string> => {
  const hash = createHash('sha256')
  hash.update(NODE_IMAGE)
  hash.update(SKEW_EFFECT_VERSION)
  const closure = resolveWorkspaceClosure(await readPackableWorkspaceManifests(REPO_ROOT), ENTRY_PACKAGES)
  for (const packageName of [...closure].sort()) {
    const directory = workspacePackageDirectory(packageName)
    hash.update(packageName)
    await hashIfPresent(hash, directory, 'package.json')
    await hashIfPresent(hash, directory, 'src')
  }
  await hashDirectory(hash, TEST_RESOURCES_DIR, '')
  await hashDirectory(hash, IMAGE_ASSETS_DIR, '')
  return `${IMAGE_TAG_PREFIX}:${hash.digest('hex').slice(0, 16)}`
}

const tmpfsBuildScaffoldEnv = async (): Promise<Record<string, string> | undefined> => {
  const shm = await stat('/dev/shm').catch(() => undefined)
  if (shm === undefined || !shm.isDirectory()) {
    return undefined
  }
  const dir = join('/dev/shm', 'stryker-js-effect-e2e')
  await mkdir(dir, { recursive: true })
  return { TMPDIR: dir }
}

const runProcess = (binary: string, args: readonly string[], env?: Record<string, string>): Promise<ExecResult> => {
  const { promise, resolve, reject } = Promise.withResolvers<ExecResult>()
  const child = spawn(binary, [...args], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: env === undefined ? undefined : { ...process.env, ...env },
  })
  const stdout: Buffer[] = []
  const stderr: Buffer[] = []
  child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk))
  child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk))
  child.on('error', reject)
  child.on('close', (code) => {
    resolve({
      exitCode: code ?? 1,
      stdout: Buffer.concat(stdout).toString('utf8'),
      stderr: Buffer.concat(stderr).toString('utf8'),
    })
  })
  return promise
}

const noteHostNetworking = async (tag: string): Promise<void> => {
  const runtime = await runtimeBinary()
  const hostProbe = await runProcess(runtime, ['run', '--rm', '--network', 'host', '--entrypoint', 'true', tag])
  hostNetworking = hostProbe.exitCode === 0
}

const adoptExistingImage = async (tag: string): Promise<boolean> => {
  const runtime = await runtimeBinary()
  const inspected = await runProcess(runtime, ['image', 'inspect', tag])
  if (inspected.exitCode !== 0) return false
  imageTag = tag
  await noteHostNetworking(tag)
  return true
}

const buildImage = async (tag: string, contextDir: string): Promise<void> => {
  const runtime = await runtimeBinary()
  const inspected = await runProcess(runtime, ['image', 'inspect', tag])
  if (inspected.exitCode !== 0) {
    await requireStep(`build the baked fixture image ${tag} with ${runtime}`, async () => {
      const result = await runProcess(runtime, ['build', '--tag', tag, contextDir], await tmpfsBuildScaffoldEnv())
      if (result.exitCode !== 0) {
        throw new Error(`image build exited ${result.exitCode}:\n${result.stderr.slice(-4000)}`)
      }
    })
  }
  await requireStep('verify the baked fixtures exist in the image', async () => {
    const result = await runProcess(runtime, ['run', '--rm', '--entrypoint', 'ls', tag, '/baked'])
    if (result.exitCode !== 0 || !result.stdout.includes('enterprise-monorepo-fixture')) {
      throw new Error(`baked fixture probe exited ${result.exitCode}: ${result.stdout.trim()} ${result.stderr.trim()}`)
    }
  })
  await noteHostNetworking(tag)
}

const assembleBuildContext = async (contextDir: string): Promise<void> => {
  const packsDir = join(contextDir, 'packs')
  await mkdir(packsDir, { recursive: true })
  await packWorkspaceClosure(packsDir)
  await packSkewChecker(scratch ?? contextDir, join(contextDir, 'packs-skew'))
  await copyFixturesIntoContext(contextDir)
  await mkdir(join(contextDir, 'image'), { recursive: true })
  await copyFile(join(IMAGE_ASSETS_DIR, 'Dockerfile'), join(contextDir, 'Dockerfile'))
  await copyFile(join(IMAGE_ASSETS_DIR, 'entrypoint.sh'), join(contextDir, 'image', 'entrypoint.sh'))
}

const ensureImage = async (): Promise<void> => {
  const tag = await fingerprintTag()
  if (await adoptExistingImage(tag)) return
  const directory = await requireStep(
    'create the image build scratch directory',
    () => mkdtemp(join(tmpdir(), 'stryker-e2e-image-')),
  )
  scratch = directory
  const contextDir = join(directory, 'context')
  await mkdir(contextDir, { recursive: true })
  await assembleBuildContext(contextDir)
  await buildImage(tag, contextDir)
  imageTag = tag
}

export const ensureContainerEnvironment = async (): Promise<void> => {
  ready ??= ensureImage()
  await ready
}

export const teardownContainerEnvironment = async (): Promise<void> => {
  const directory = scratch
  scratch = undefined
  imageTag = undefined
  installedFixtures.clear()
  workspacesByDir.clear()
  const dirs = [...workspaceDirs]
  workspaceDirs.clear()
  for (const dir of dirs) {
    await rm(dir, { recursive: true, force: true })
  }
  if (directory !== undefined) {
    await rm(directory, { recursive: true, force: true })
  }
}

const requireImageTag = (): string => {
  const tag = imageTag
  if (tag === undefined) {
    throw new Error('container environment has no baked image: await ensureContainerEnvironment() first')
  }
  return tag
}

const telemetryEnvironment = (): Record<string, string> => {
  if (hostNetworking) {
    return CONTAINER_TELEMETRY_ENVIRONMENT
  }
  return {
    ...CONTAINER_TELEMETRY_ENVIRONMENT,
    OTEL_EXPORTER_OTLP_ENDPOINT: CONTAINER_TELEMETRY_ENVIRONMENT.OTEL_EXPORTER_OTLP_ENDPOINT.replace(
      '127.0.0.1',
      'host.containers.internal',
    ).replace('localhost', 'host.containers.internal'),
  }
}

const rawExec = async (command: readonly string[], cwd: string): Promise<ExecResult> => {
  await ensureContainerEnvironment()
  const fixtureId = workspacesByDir.get(cwd)
  if (fixtureId === undefined) {
    throw new Error(`cwd ${cwd} is not a workspace created by installFixture`)
  }
  const args = ['run', '--rm']
  if (hostNetworking) {
    args.push('--network', HOST_NETWORK_MODE)
  }
  for (const [key, value] of Object.entries(telemetryEnvironment())) {
    args.push('--env', `${key}=${value}`)
  }
  args.push('--volume', `${cwd}:${CONTAINER_WORKROOT}`)
  args.push(requireImageTag(), fixtureId, ...command)
  return runProcess(await runtimeBinary(), args)
}

export function runCli(args: readonly string[], opts: { readonly cwd: string }): Promise<ExecResult> {
  return rawExec(['npx', '--no-install', 'stryker', ...args], opts.cwd)
}

export function runShell(command: string, opts: { readonly cwd: string }): Promise<ExecResult> {
  return rawExec(['sh', '-c', command], opts.cwd)
}

export async function readWorkspaceFile(path: string): Promise<string> {
  return readFile(path, 'utf8')
}

export async function readHostJson(url: URL): Promise<unknown> {
  const document: unknown = JSON.parse(await readFile(fileURLToPath(url), 'utf8'))
  return document
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
    await ensureContainerEnvironment()
    const dir = await requireStep(
      `create the ${name} workspace directory`,
      () => mkdtemp(join(tmpdir(), `stryker-e2e-${name}-`)),
    )
    workspacesByDir.set(dir, fixtureId)
    workspaceDirs.add(dir)
    return dir
  })()
  installedFixtures.set(name, task)
  return task
}
