import { execFile } from 'node:child_process'
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
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

const PLUGIN_PACKAGES = [
  '@systemfsoftware/stryker-js-vitest-runner',
  '@systemfsoftware/stryker-js-language',
  '@systemfsoftware/stryker-js-plugin-interface',
  '@systemfsoftware/stryker-ignorer-interface',
] as const

const PACKED_PACKAGES = [CLI_PACKAGE, ...PLUGIN_PACKAGES] as const

const PACKED_TARBALL_VERSION = /-(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\.tgz$/

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

const installCliGlobally = async (running: StartedTestContainer, cli: PackedPackage): Promise<void> => {
  await requireStep(`npm install -g ${cli.fileName}`, async () => {
    const result = await running.exec(['npm', 'install', '-g', cli.tarballPath])
    if (result.exitCode !== 0) {
      throw new Error(`npm exited ${result.exitCode}: ${result.stderr.trim()}`)
    }
  })
}

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
      .withWorkingDir(CONTAINER_WORKROOT)
      .withStartupTimeout(STARTUP_TIMEOUT_MS)
      .start())
  container = running
  await writeContainerWorkDirectories(running)
  await copyTarballs(running, directory, Object.values(packed))
  await installCliGlobally(running, packedPackage(CLI_PACKAGE))
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
  const result = await running.exec([...command], workingDirOption(cwd))
  return { exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr }
}

export function runCli(args: readonly string[], opts?: { readonly cwd?: string | undefined }): Promise<ExecResult> {
  return rawExec(['stryker', ...args], opts?.cwd)
}

export function runShell(command: string, opts?: { readonly cwd?: string | undefined }): Promise<ExecResult> {
  return rawExec(['sh', '-c', command], opts?.cwd)
}

export async function readHostJson(url: URL): Promise<unknown> {
  const document: unknown = JSON.parse(await readFile(fileURLToPath(url), 'utf8'))
  return document
}

export async function installFixture(fixtureUrl: URL, name: string): Promise<string> {
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
      step: `npm install the plugin tarballs in ${name}`,
      args: ['npm', 'install', ...PLUGIN_PACKAGES.map((packageName) => packedPackage(packageName).tarballPath)],
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
