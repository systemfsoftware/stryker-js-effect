import { execFile } from 'node:child_process'
import { copyFile, mkdir, mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

import { GenericContainer, type StartedTestContainer } from 'testcontainers'

const execFileAsync = promisify(execFile)

export const CONTAINER_WORKROOT = '/work'

const TARBALL_DIR = '/tmp/e2e'

const NODE_IMAGE = 'node:24-alpine@sha256:333f6b3eca25980d5682c26207665b93c9417786b21760b2764d5821d9704c8a'

const REPO_ROOT = fileURLToPath(new URL('../../../..', import.meta.url))

const CLI_PACKAGE = '@systemfsoftware/stryker-js-cli'

const PLUGIN_PACKAGES = ['@systemfsoftware/stryker-js-vitest-runner'] as const

const PACKED_PACKAGES = [CLI_PACKAGE, ...PLUGIN_PACKAGES] as const

const PACKED_TARBALL_VERSION = /-(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\.tgz$/

const VITEST_RUNNER_PACKAGE = PLUGIN_PACKAGES[0]

const HOST_NETWORK_MODE = 'host'

const SKEW_CHECKER_PACKAGE = '@systemfsoftware/stryker-js-effect-skew-checker'

const SKEW_EFFECT_VERSION = '4.0.0-rc.111'

const SKEW_CHECKER_DIRECTORY = fileURLToPath(new URL('../../testResources/effect-skew-checker', import.meta.url))

const CONTAINER_TELEMETRY_ENVIRONMENT = {
  OTEL_ENABLED: process.env['OTEL_ENABLED'] ?? 'false',
  OTEL_SERVICE_NAME: process.env['OTEL_SERVICE_NAME'] ?? 'stryker-js-cli-e2e',
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

const packWorkspacePackages = async (directory: string): Promise<Readonly<Record<string, PackedPackage>>> => {
  for (const packageName of PACKED_PACKAGES) {
    await requireStep(
      `build ${packageName}`,
      () => execFileAsync('pnpm', ['--filter', packageName, 'build'], { cwd: REPO_ROOT }),
    )
    await requireStep(
      `pack ${packageName}`,
      () =>
        execFileAsync('pnpm', ['--filter', packageName, 'pack', '--pack-destination', directory], { cwd: REPO_ROOT }),
    )
  }
  const fileNames = await requireStep('read the packed tarballs', () => readdir(directory))
  return Object.fromEntries(
    PACKED_PACKAGES.map((packageName) => [packageName, packedTarballOf(fileNames, packageName, directory)]),
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

const startBed = async (): Promise<void> => {
  const directory = await requireStep(
    'create the pack scratch directory',
    () => mkdtemp(join(tmpdir(), 'stryker-e2e-')),
  )
  scratch = directory
  const packed = await packWorkspacePackages(directory)
  packedPackages = packed

  const running = await requireStep('start the node:24-alpine container', () =>
    new GenericContainer(NODE_IMAGE)
      .withCommand(['sleep', 'infinity'])
      .withNetworkMode(HOST_NETWORK_MODE)
      .withWorkingDir(CONTAINER_WORKROOT)
      .withStartupTimeout(STARTUP_TIMEOUT_MS)
      .start())
  container = running
  await writeContainerWorkDirectories(running)
  await copyTarballs(running, directory, Object.values(packed))
}

export const ensureBed = async (): Promise<void> => {
  ready ??= startBed()
  await ready
}

export const teardownBed = async (): Promise<void> => {
  const running = container
  const directory = scratch
  container = undefined
  scratch = undefined
  packedPackages = undefined
  ready = undefined
  skewCheckerReady = undefined
  if (running !== undefined) {
    await requireStep('stop the node:24-alpine container', () => running.stop())
  }
  if (directory !== undefined) {
    await rm(directory, { recursive: true, force: true })
  }
}

export function packedPackage(packageName: string): PackedPackage {
  const entry = packedPackages?.[packageName]
  if (entry === undefined) {
    throw new Error(`the bed has not packed ${packageName}: await ensureBed() first`)
  }
  return entry
}

export function cliPackage(): PackedPackage {
  return packedPackage(CLI_PACKAGE)
}

const workingDirOption = (cwd: string | undefined): { readonly workingDir: string } | undefined => {
  if (cwd === undefined) {
    return undefined
  }
  return { workingDir: cwd }
}

const rawExec = async (command: readonly string[], cwd: string | undefined): Promise<ExecResult> => {
  await ensureBed()
  const running = container
  if (running === undefined) {
    throw new Error('the bed has no container: await ensureBed() first')
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

export async function readHostJson(url: URL): Promise<unknown> {
  const document: unknown = JSON.parse(await readFile(fileURLToPath(url), 'utf8'))
  return document
}

export async function installFixture(
  fixtureUrl: URL,
  name: string,
  extraTarballs: readonly PackedPackage[] = [],
): Promise<string> {
  const hostFixtureDir = fileURLToPath(fixtureUrl)
  await ensureBed()
  const running = container
  if (running === undefined) {
    throw new Error('the bed has no container: await ensureBed() first')
  }
  const fixturePath = `${CONTAINER_WORKROOT}/${name}`
  await requireStep(
    `copy the ${name} fixture into the container`,
    () => running.copyDirectoriesToContainer([{ source: hostFixtureDir, target: fixturePath }]),
  )
  const installSteps = [
    { step: `npm install the ${name} registry dependencies`, args: ['npm', 'install'] },
    {
      step: `npm install the CLI and plugin tarballs in ${name}`,
      args: [
        'npm',
        'install',
        cliPackage().tarballPath,
        ...PLUGIN_PACKAGES.map((packageName) => packedPackage(packageName).tarballPath),
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
    await ensureBed()
    const directory = scratch
    const running = container
    if (directory === undefined || running === undefined) {
      throw new Error('the bed has no scratch directory: await ensureBed() first')
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
