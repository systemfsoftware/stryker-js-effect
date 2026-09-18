import { join } from '@std/path'
import { run } from './run.ts'

import { extractYaml, test } from '@std/front-matter'
import { parse } from '@std/yaml'
export type CycleEntry = {
  name: string
  version: string
  tag: string
  changelog: string
}

export const changelogPath = (name: string, version: string): string =>
  join('.changeset', 'changelogs', `${name.replace('/', '!')}@${version}.md`)

export const ensureChangelog = async (name: string, version: string): Promise<string> => {
  const p = changelogPath(name, version)
  try {
    const existing = await Deno.readTextFile(p)
    if (existing.trim().length > 0) return existing
  } catch {
    // absent or unreadable
  }

  let ledger: Record<string, { dir: string; intents: string[] }> = {}
  try {
    const raw = parse(await Deno.readTextFile('.changeset/ledger.yaml'))
    if (raw && typeof raw === 'object') ledger = raw as Record<string, { dir: string; intents: string[] }>
  } catch {
    return ''
  }

  const key = `${name}@${version}`
  const val = ledger[key]
  if (!val || !Array.isArray(val.intents)) return ''

  const titleMap: Record<string, string> = {
    major: 'Major Changes',
    minor: 'Minor Changes',
    patch: 'Patch Changes',
  }

  const entriesByBump: Record<string, string[]> = {
    major: [],
    minor: [],
    patch: [],
  }

  for (const intentStem of val.intents) {
    const intentPath = `.changeset/${intentStem}.md`
    let raw = ''
    try {
      raw = await Deno.readTextFile(intentPath)
    } catch {
      continue
    }
    if (!test(raw)) continue
    const { attrs, body } = extractYaml<Record<string, string>>(raw)
    const bump = attrs[name]
    if (!bump || !entriesByBump[bump]) continue
    const summary = body.trim()
    if (!summary) continue

    const lines = summary.split('\n')
    let item = `- ${lines[0]}`
    for (let i = 1; i < lines.length; i++) {
      item += '\n' + (lines[i] ? `  ${lines[i]}` : '')
    }
    entriesByBump[bump].push(item)
  }

  const parts = [`## ${version}`]
  for (const bump of ['major', 'minor', 'patch']) {
    if (entriesByBump[bump].length > 0) {
      parts.push(`### ${titleMap[bump]}`)
      parts.push(entriesByBump[bump].join('\n\n'))
    }
  }

  if (parts.length === 1) {
    parts.push(`### Patch Changes`)
    parts.push(`- Version bump`)
  }

  const content = parts.join('\n\n') + '\n'
  try {
    await Deno.mkdir('.changeset/changelogs', { recursive: true })
    await Deno.writeTextFile(p, content)
  } catch {
    // best effort write
  }
  return content
}

type Pkg = {
  name?: string
  version?: string
  private?: boolean
}

type Released = { name: string; version: string }

const publicPackages = async (): Promise<Released[]> => {
  const pkgs = JSON.parse(await run('pnpm', ['ls', '-r', '--json', '--depth=-1'])) as Pkg[]
  return pkgs
    .filter((pkg): pkg is Pkg & Released => Boolean(pkg.name && pkg.version) && !pkg.private)
    .map(({ name, version }) => ({ name, version }))
}

const isPublished = async (name: string, version: string): Promise<boolean> => {
  const res = await fetch(`https://registry.npmjs.org/${encodeURIComponent(name)}/${version}`)
  if (res.status === 404) return false
  if (!res.ok) throw new Error(`registry returned ${res.status} for ${name}@${version}`)
  return true
}

export const unpublishedOf = async <T extends Released>(items: T[]): Promise<T[]> => {
  const published = await Promise.all(items.map(({ name, version }) => isPublished(name, version)))
  return items.filter((_, i) => !published[i])
}

export const loadWorkspaceCycle = async (): Promise<CycleEntry[]> =>
  (await unpublishedOf(await publicPackages())).map(({ name, version }) => ({
    name,
    version,
    tag: `${name}@v${version}`,
    changelog: changelogPath(name, version),
  }))

export const loadCaptured = async (path: string): Promise<CycleEntry[]> => {
  const raw: unknown = JSON.parse(await Deno.readTextFile(path))
  if (!Array.isArray(raw)) throw new Error('captured file must be a JSON array')
  return raw as CycleEntry[]
}
