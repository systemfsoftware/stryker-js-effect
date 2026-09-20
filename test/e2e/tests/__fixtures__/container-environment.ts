import { execFile } from 'node:child_process'
import { copyFile, mkdir, mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

import { GenericContainer, type StartedTestContainer } from 'testcontainers'

import { readPackableWorkspaceManifests, resolveWorkspaceClosure } from './closure-resolver.js'

const execFileAsync = promisify(execFile)

export const CONTAINER_WORKROOT = '/work'

const TARBALL_DIR = '/tmp/e2e'

const NPM_CACHE_HOST_DIR = join(tmpdir(), 'stryker-e2e-npm-cache')
const NODE_IMAGE = 'node:24-alpine@sha256:333f6b3eca25980d5682c26207665b93c9417786b21760b2764d5821d9704c8a'

const REPO_ROOT = fileURLToPath(new URL('../../../..', import.meta.url))

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

const SKEW_CHECKER_DIRECTORY = fileURLToPath(new URL('../../testResources/effect-skew-checker', import.meta.url))

const CONTAINER_TELEMETRY_ENVIRONMENT = {
  OTEL_ENABLED: process.env['OTEL_ENABLED'] ?? 'false',
  OTEL_SERVICE_NAME: process.env['OTEL_SERVICE_NAME'] ?? 'stryker-e2e',
  OTEL_EXPORTER_OTLP_ENDPOINT: process.env['OTEL_EXPORTER_OTLP_ENDPOINT'] ?? 'http://127.0.0.1:4318',
}

const workspacePackageDirectory = (packageName: string): string =>
  join(REPO_ROOT, 'packages', packageName.slice('@systemfsoftware/'.length))

const STARTUP_TIMEOUT_MS = 120_000

export type ExecResult = {
  readonly exitCode: number
  readonly stdout: string
  readonly stderr: string
}

export type PackedPackage = {
  readonly name: string
  readonly version: string
  readonly fileName: string
  readonly tarballPath: string
}

let container: StartedTestContainer | undefined
let scratch: string | undefined
let packedPackages: Readonly<Record<string, PackedPackage>> | undefined
let ready: Promise<void> | undefined
let skewCheckerReady: Promise<PackedPackage> | undefined
const installedFixtures = new Map<string, Promise<string>>()
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
  return { name: packageName, version, fileName, tarballPath: `${TARBALL_DIR}/${fileName}` }
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

const writeContainerWorkDirectories = async (running: StartedTestContainer): Promise<void> => {
  await requireStep('create the container work directories', async () => {
    const result = await running.exec(['mkdir', '-p', CONTAINER_WORKROOT, TARBALL_DIR])
    if (result.exitCode !== 0) {
      throw new Error(`mkdir exited ${result.exitCode}: ${result.stderr.trim()}`)
    }
  })
}

const copyTarballs = async (
  running: StartedTestContainer,
  directory: string,
  files: readonly PackedPackage[],
): Promise<void> =>
  requireStep('copy the packed tarballs into the container', () =>
    running.copyFilesToContainer(
      files.map((file) => ({ source: join(directory, file.fileName), target: file.tarballPath })),
    ))

const startContainerEnvironment = async (): Promise<void> => {
  const directory = await requireStep(
    'create the pack scratch directory',
    () => mkdtemp(join(tmpdir(), 'stryker-e2e-')),
  )
  scratch = directory
  await requireStep(
    'create the shared npm cache directory',
    () => mkdir(NPM_CACHE_HOST_DIR, { recursive: true }),
  )
  const packed = await packWorkspaceClosure(directory)
  packedPackages = packed

  const running = await requireStep('start the node:24-alpine container', () =>
    new GenericContainer(NODE_IMAGE)
      .withCommand(['sleep', 'infinity'])
      .withNetworkMode(HOST_NETWORK_MODE)
      .withWorkingDir(CONTAINER_WORKROOT)
      .withBindMounts([{ source: NPM_CACHE_HOST_DIR, target: '/root/.npm', mode: 'rw' }])
      .withStartupTimeout(STARTUP_TIMEOUT_MS)
      .start())
  container = running
  await writeContainerWorkDirectories(running)
  await copyTarballs(running, directory, Object.values(packed))
}

export const ensureContainerEnvironment = async (): Promise<void> => {
  ready ??= startContainerEnvironment()
  await ready
}

export const teardownContainerEnvironment = async (): Promise<void> => {
  const running = container
  const directory = scratch
  container = undefined
  scratch = undefined
  packedPackages = undefined
  ready = undefined
  skewCheckerReady = undefined
  installedFixtures.clear()
  if (running !== undefined) {
    await requireStep('stop the node:24-alpine container', () => running.stop())
  }
  if (directory !== undefined) {
    await rm(directory, { recursive: true, force: true })
  }
}

const packedTarballs = (): ReadonlyArray<PackedPackage> => {
  const packed = packedPackages
  if (packed === undefined) {
    throw new Error(
      'container environment has not packed the workspace closure: await ensureContainerEnvironment() first',
    )
  }
  return Object.values(packed)
}

const workingDirOption = (cwd: string | undefined): { readonly workingDir: string } | undefined => {
  if (cwd === undefined) {
    return undefined
  }
  return { workingDir: cwd }
}

const rawExec = async (command: readonly string[], cwd: string | undefined): Promise<ExecResult> => {
  await ensureContainerEnvironment()
  const running = container
  if (running === undefined) {
    throw new Error('container environment has no running container: await ensureContainerEnvironment() first')
  }
  const result = await running.exec([...command], {
    ...workingDirOption(cwd),
    env: CONTAINER_TELEMETRY_ENVIRONMENT,
  })
  return { exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr }
}

export function runCli(args: readonly string[], opts?: { readonly cwd?: string | undefined }): Promise<ExecResult> {
  return rawExec(['npx', '--no-install', 'stryker', ...args], opts?.cwd)
}

export function runShell(command: string, opts?: { readonly cwd?: string | undefined }): Promise<ExecResult> {
  return rawExec(['sh', '-c', command], opts?.cwd)
}
export async function readContainerFile(path: string): Promise<string> {
  await ensureContainerEnvironment()
  const res = await runShell(`cat "${path}"`)
  if (res.exitCode !== 0) {
    throw new Error(`failed to read container file ${path}: ${res.stderr}`)
  }
  return res.stdout
}

export async function readHostJson(url: URL): Promise<unknown> {
  const document: unknown = JSON.parse(await readFile(fileURLToPath(url), 'utf8'))
  return document
}

export function installFixture(
  fixtureUrl: URL,
  name: string,
  extraTarballs: readonly PackedPackage[] = [],
): Promise<string> {
  const cached = installedFixtures.get(name)
  if (cached !== undefined) {
    return cached
  }
  const task = (async () => {
    const hostFixtureDir = fileURLToPath(fixtureUrl)
    await ensureContainerEnvironment()
    const running = container
    if (running === undefined) {
      throw new Error('container environment has no running container: await ensureContainerEnvironment() first')
    }
    const fixturePath = `${CONTAINER_WORKROOT}/${name}`
    await requireStep(
      `copy the ${name} fixture into the container`,
      () => running.copyDirectoriesToContainer([{ source: hostFixtureDir, target: fixturePath }]),
    )
    const installSteps = [
      { step: `npm install the ${name} registry dependencies`, args: ['npm', 'install'] },
      {
        step: `npm install the workspace closure tarballs in ${name}`,
        args: [
          'npm',
          'install',
          ...packedTarballs().map((packed) => packed.tarballPath),
          ...extraTarballs.map((packed) => packed.tarballPath),
        ],
      },
    ]
    for (const { step, args } of installSteps) {
      await requireStep(step, async () => {
        const result = await running.exec(args, { workingDir: fixturePath })
        if (result.exitCode !== 0) {
          throw new Error(`npm exited ${result.exitCode}: ${result.stderr.trim()}`)
        }
      })
    }
    return fixturePath
  })()
  installedFixtures.set(name, task)
  return task
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

export const ensureSkewChecker = async (): Promise<PackedPackage> => {
  skewCheckerReady ??= (async () => {
    await ensureContainerEnvironment()
    const directory = scratch
    const running = container
    if (directory === undefined || running === undefined) {
      throw new Error('container environment has no scratch directory: await ensureContainerEnvironment() first')
    }
    const bundledDirectory = await buildSkewCheckerBundle(directory)
    const packageDirectory = await stageSkewCheckerPackage(directory, bundledDirectory)
    await requireStep(
      'pack the effect-skew checker',
      () => execFileAsync('npm', ['pack', packageDirectory, '--pack-destination', directory], { cwd: directory }),
    )
    const fileNames = await requireStep('read the packed effect-skew checker', () => readdir(directory))
    const packed = packedTarballOf(fileNames, SKEW_CHECKER_PACKAGE, directory)
    await copyTarballs(running, directory, [packed])
    return packed
  })()
  return skewCheckerReady
}
