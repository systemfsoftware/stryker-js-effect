import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

export type WorkspaceManifest = {
  readonly name: string
  readonly private?: boolean | undefined
  readonly dependencies?: Readonly<Record<string, string>> | undefined
  readonly peerDependencies?: Readonly<Record<string, string>> | undefined
  readonly devDependencies?: Readonly<Record<string, string>> | undefined
}

const PACKAGES_DIRECTORY = 'packages'
const MANIFEST_FILE = 'package.json'
const WORKSPACE_SPEC_PREFIX = 'workspace:'

const linkedWorkspaceDependenciesOf = (manifest: WorkspaceManifest): ReadonlyArray<string> =>
  Object.entries({ ...manifest.dependencies, ...manifest.peerDependencies })
    .filter(([, spec]) => spec.startsWith(WORKSPACE_SPEC_PREFIX))
    .map(([dependency]) => dependency)

export const resolveWorkspaceClosure = (
  manifests: ReadonlyMap<string, WorkspaceManifest>,
  entryPackages: ReadonlyArray<string>,
): ReadonlyArray<string> => {
  const closure = new Set<string>()
  const visit = (packageName: string): void => {
    if (closure.has(packageName)) {
      return
    }
    const manifest = manifests.get(packageName)
    if (manifest === undefined) {
      throw new Error(`cannot install ${packageName}: the workspace holds no packable manifest for it`)
    }
    closure.add(packageName)
    for (const dependency of linkedWorkspaceDependenciesOf(manifest)) {
      visit(dependency)
    }
  }
  for (const entryPackage of entryPackages) {
    visit(entryPackage)
  }
  return [...closure].sort()
}

const manifestFileIn = async (directory: string): Promise<string | undefined> => {
  const entries = await readdir(directory, { withFileTypes: true })
  const manifest = entries.find((entry) => entry.isFile() && entry.name === MANIFEST_FILE)
  return manifest === undefined ? undefined : join(directory, MANIFEST_FILE)
}

const recordManifestOf = async (
  manifests: Map<string, WorkspaceManifest>,
  directory: string,
): Promise<boolean> => {
  const manifestPath = await manifestFileIn(directory)
  if (manifestPath === undefined) {
    return false
  }
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as WorkspaceManifest
  if (manifest.private !== true) {
    manifests.set(manifest.name, manifest)
  }
  return true
}

const recordGroupedManifestsOf = async (
  manifests: Map<string, WorkspaceManifest>,
  groupDirectory: string,
): Promise<void> => {
  for (const nested of await readdir(groupDirectory, { withFileTypes: true })) {
    if (nested.isDirectory()) {
      await recordManifestOf(manifests, join(groupDirectory, nested.name))
    }
  }
}

export const readPackableWorkspaceManifests = async (
  repoRoot: string,
): Promise<ReadonlyMap<string, WorkspaceManifest>> => {
  const manifests = new Map<string, WorkspaceManifest>()
  const packagesDirectory = join(repoRoot, PACKAGES_DIRECTORY)
  for (const member of await readdir(packagesDirectory, { withFileTypes: true })) {
    if (!member.isDirectory()) {
      continue
    }
    const directory = join(packagesDirectory, member.name)
    if (await recordManifestOf(manifests, directory)) {
      continue
    }
    await recordGroupedManifestsOf(manifests, directory)
  }
  return manifests
}
