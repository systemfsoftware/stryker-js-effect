import { run } from './run.ts'

export const WORKFLOW_FILE = 'release.yml'

export const parseSlug = (raw: string): string | null => {
  const cleaned = raw.trim()
    .replace(/^git\+/, '')
    .replace(/^git@github\.com:/, 'https://github.com/')
    .replace(/^https?:\/\/github\.com\//, '')
    .replace(/\.git$/, '')
  const parts = cleaned.split('/').filter(Boolean)
  if (parts.length < 2) return null
  return `${parts[0]}/${parts[1]}`
}

export const expectedSlug = async (): Promise<string> => {
  const env = Deno.env.get('GITHUB_REPOSITORY')
  if (env && env.includes('/')) return env
  const remoteUrl = await run('git', ['remote', 'get-url', 'origin'])
  const slug = parseSlug(remoteUrl)
  if (!slug) throw new Error(`Could not derive repository slug from git remote: ${remoteUrl}`)
  return slug
}

type PkgInfo = {
  name?: string
  version?: string
  path?: string
  private?: boolean
}

export type WorkspacePackage = {
  name: string
  version: string
  filePath: string
  repositorySlug: string | null
}

export const publicWorkspacePackages = async (): Promise<WorkspacePackage[]> => {
  const rawPkgs = JSON.parse(await run('pnpm', ['ls', '-r', '--json', '--depth=-1'])) as PkgInfo[]
  const out: WorkspacePackage[] = []
  for (const pkg of rawPkgs) {
    if (!pkg.name || !pkg.version || pkg.private || !pkg.path) continue
    const packageJsonPath = `${pkg.path}/package.json`
    let repoSlug: string | null = null
    try {
      const manifest = JSON.parse(await Deno.readTextFile(packageJsonPath)) as {
        repository?: string | { url?: string }
      }
      const rawUrl = typeof manifest.repository === 'string' ? manifest.repository : manifest.repository?.url
      if (rawUrl) repoSlug = parseSlug(rawUrl)
    } catch {
      repoSlug = null
    }
    out.push({
      name: pkg.name,
      version: pkg.version,
      filePath: packageJsonPath,
      repositorySlug: repoSlug,
    })
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
}

export const packageExistsOnRegistry = async (name: string): Promise<boolean> => {
  const res = await fetch(`https://registry.npmjs.org/${encodeURIComponent(name)}`)
  if (res.status === 404) return false
  if (!res.ok) throw new Error(`Registry returned ${res.status} for ${name}`)
  await res.body?.cancel()
  return true
}

export const trustCommand = (name: string, slug: string, file = WORKFLOW_FILE): string =>
  `npm trust github ${name} --file ${file} --repository ${slug} --allow-publish --allow-stage-publish -y`
