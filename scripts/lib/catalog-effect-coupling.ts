import { expandGlob } from '@std/fs/expand-glob'
import { join } from '@std/path'
import { parse } from '@std/yaml'

export type InstalledManifest = {
  readonly name: string
  readonly version: string
  readonly effectPeer?: string | undefined
}

const EXACT_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/

const WORKSPACE_FILE = 'pnpm-workspace.yaml'

const VIRTUAL_STORE = 'node_modules/.pnpm'

const exactEffectPeerOf = (manifest: InstalledManifest): string | undefined => {
  const peer = manifest.effectPeer
  return peer !== undefined && EXACT_VERSION.test(peer) ? peer : undefined
}

const buildsByName = (
  installed: ReadonlyArray<InstalledManifest>,
): ReadonlyMap<string, ReadonlyArray<InstalledManifest>> => {
  const byName = new Map<string, InstalledManifest[]>()
  for (const manifest of installed) {
    const builds = byName.get(manifest.name)
    if (builds === undefined) {
      byName.set(manifest.name, [manifest])
      continue
    }
    builds.push(manifest)
  }
  return byName
}

export const catalogCouplingViolations = (
  catalog: Readonly<Record<string, string>>,
  installed: ReadonlyArray<InstalledManifest>,
): ReadonlyArray<string> => {
  const effectPin: string | undefined = catalog['effect']
  const effectPinnedExactly = effectPin !== undefined && EXACT_VERSION.test(effectPin)
  const violations: string[] = []
  if (!effectPinnedExactly) {
    violations.push(
      `the catalog pins effect@${
        effectPin ?? 'nothing'
      }: packages that ship an exact effect peer need the catalog to pin one exact effect release`,
    )
  }
  for (const [name, builds] of buildsByName(installed)) {
    const pin = catalog[name]
    if (pin === undefined) {
      continue
    }
    const effectLocked = builds.find((build) => exactEffectPeerOf(build) !== undefined)
    if (effectLocked === undefined) {
      continue
    }
    if (!EXACT_VERSION.test(pin)) {
      violations.push(
        `${name} is catalog-pinned as "${pin}": its ${effectLocked.version} build peers effect@${
          exactEffectPeerOf(effectLocked)
        }, so a later release of it may demand a different effect release`,
      )
      continue
    }
    const pinned = builds.find((build) => build.version === pin)
    const pinnedPeer = pinned === undefined ? undefined : exactEffectPeerOf(pinned)
    if (effectPinnedExactly && pinnedPeer !== undefined && pinnedPeer !== effectPin) {
      violations.push(
        `${name}@${pin} peers effect@${pinnedPeer} but the catalog pins effect@${effectPin ?? 'nothing'}`,
      )
    }
  }
  return violations
}

const readCatalog = async (repoRoot: string): Promise<Readonly<Record<string, string>>> => {
  const workspace: unknown = parse(await Deno.readTextFile(join(repoRoot, WORKSPACE_FILE)))
  if (workspace === null || typeof workspace !== 'object' || Array.isArray(workspace)) {
    throw new Error(`${WORKSPACE_FILE} holds no mapping`)
  }
  const catalog = (workspace as Record<string, unknown>)['catalog']
  if (catalog === null || typeof catalog !== 'object' || Array.isArray(catalog)) {
    throw new Error(`${WORKSPACE_FILE} holds no catalog`)
  }
  const entries: Record<string, string> = {}
  for (const [name, spec] of Object.entries(catalog)) {
    if (typeof spec === 'string') {
      entries[name] = spec
    }
  }
  return entries
}

const installedManifestsOf = async (
  repoRoot: string,
  packageName: string,
): Promise<ReadonlyArray<InstalledManifest>> => {
  const pattern = `${VIRTUAL_STORE}/${packageName.replace('/', '+')}@*/node_modules/${packageName}/package.json`
  const manifests: InstalledManifest[] = []
  const seen = new Set<string>()
  for await (const entry of expandGlob(pattern, { root: repoRoot })) {
    const manifest = JSON.parse(await Deno.readTextFile(entry.path)) as {
      readonly version?: string | undefined
      readonly peerDependencies?: Readonly<Record<string, string>> | undefined
    }
    if (manifest.version === undefined || seen.has(manifest.version)) {
      continue
    }
    seen.add(manifest.version)
    manifests.push({
      name: packageName,
      version: manifest.version,
      effectPeer: manifest.peerDependencies?.['effect'],
    })
  }
  return manifests
}

export const catalogEffectCouplingViolations = async (repoRoot: string): Promise<ReadonlyArray<string>> => {
  const catalog = await readCatalog(repoRoot)
  const installed: InstalledManifest[] = []
  for (const packageName of Object.keys(catalog)) {
    installed.push(...(await installedManifestsOf(repoRoot, packageName)))
  }
  return catalogCouplingViolations(catalog, installed)
}
