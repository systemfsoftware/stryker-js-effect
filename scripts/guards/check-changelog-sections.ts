#!/usr/bin/env -S deno run --allow-read --allow-run=pnpm
import { expandGlob } from '@std/fs/expand-glob'
import { join } from '@std/path'
import { parse } from '@std/yaml'
import { run } from '../lib/run.ts'

const WORKSPACE_MANIFEST = 'pnpm-workspace.yaml'
const PARKED_DIRECTORY = '.changeset/changelogs'

interface Member {
  readonly name: string
  readonly version: string
  readonly dir: string
}

const publicMembers = async (): Promise<readonly Member[]> => {
  const raw = JSON.parse(await run('pnpm', ['ls', '-r', '--depth=-1', '--json'])) as readonly {
    name?: unknown
    version?: unknown
    path?: unknown
    private?: unknown
  }[]
  return raw.flatMap((entry) =>
    entry.private !== true && typeof entry.name === 'string' && typeof entry.version === 'string' &&
      typeof entry.path === 'string'
      ? [{ name: entry.name, version: entry.version, dir: entry.path }]
      : []
  )
}

type ChangelogStorage = 'repository' | 'registry'

export class ChangelogStorageInvalid extends Error {
  override readonly name = 'ChangelogStorageInvalid'
  constructor(readonly found: unknown) {
    super(
      `pnpm-workspace.yaml: versioning.changelog.storage is ${
        found === undefined ? 'missing' : JSON.stringify(found)
      }; expected "repository" or "registry"`,
    )
  }
}

export const changelogStorageOf = (workspaceYaml: string): ChangelogStorage => {
  const document = parse(workspaceYaml) as { versioning?: { changelog?: { storage?: unknown } } } | null
  const found = document?.versioning?.changelog?.storage
  if (found === 'repository' || found === 'registry') return found
  throw new ChangelogStorageInvalid(found)
}

const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export const sectionViolations = (
  name: string,
  version: string,
  changelog: string | null,
): ReadonlyArray<string> => {
  if (changelog === null) return [`${name}@${version}: no CHANGELOG.md`]
  const headings = changelog.match(new RegExp(`^## ${escape(version)}[ \\t]*$`, 'gm'))?.length ?? 0
  return headings === 1
    ? []
    : [`${name}@${version}: CHANGELOG.md has ${headings} "## ${version}" sections, expected exactly one`]
}

export const parkedViolations = (storage: ChangelogStorage, parked: ReadonlyArray<string>): ReadonlyArray<string> =>
  storage === 'repository'
    ? parked.map((file) =>
      `${PARKED_DIRECTORY}/${file}: a parked changelog section under storage: repository is never published; fold it into the package's CHANGELOG.md`
    )
    : []

const selftest = (): number => {
  const cases: readonly { readonly name: string; readonly run: () => void }[] = [
    {
      name: 'accepts a changelog with exactly one section for the version',
      run: () => {
        const found = sectionViolations('@x/a', '1.2.0', '# @x/a\n\n## 1.2.0\n\n- b\n\n## 1.1.0\n\n- a\n')
        if (found.length !== 0) throw new Error(JSON.stringify(found))
      },
    },
    {
      name: 'refuses a changelog with no section for the version',
      run: () => {
        const found = sectionViolations('@x/a', '1.2.0', '# @x/a\n\n## 1.1.0\n\n- a\n')
        if (found.length !== 1 || !found[0]?.includes('0 ')) throw new Error(JSON.stringify(found))
      },
    },
    {
      name: 'refuses a changelog with two sections for the version',
      run: () => {
        const found = sectionViolations('@x/a', '1.2.0', '## 1.2.0\n\n- b\n\n## 1.2.0\n\n- a\n')
        if (found.length !== 1 || !found[0]?.includes('2 ')) throw new Error(JSON.stringify(found))
      },
    },
    {
      name: 'does not count a prerelease or longer version as the section',
      run: () => {
        const found = sectionViolations('@x/a', '1.2.0', '## 1.2.0-rc.1\n\n## 11.2.0\n\n## 1.2.00\n')
        if (found.length !== 1) throw new Error(JSON.stringify(found))
      },
    },
    {
      name: 'refuses a missing changelog',
      run: () => {
        const found = sectionViolations('@x/a', '1.2.0', null)
        if (found.length !== 1) throw new Error(JSON.stringify(found))
      },
    },
    {
      name: 'refuses a parked section under repository storage',
      run: () => {
        const found = parkedViolations('repository', ['@x!a@1.2.0.md'])
        if (found.length !== 1) throw new Error(JSON.stringify(found))
      },
    },
    {
      name: 'allows parked sections under registry storage',
      run: () => {
        const found = parkedViolations('registry', ['@x!a@1.2.0.md'])
        if (found.length !== 0) throw new Error(JSON.stringify(found))
      },
    },
    {
      name: 'refuses a workspace with no changelog storage',
      run: () => {
        try {
          changelogStorageOf('packages:\n  - packages/*\n')
        } catch (error) {
          if (error instanceof ChangelogStorageInvalid && error.found === undefined) return
          throw error
        }
        throw new Error('accepted a missing storage')
      },
    },
    {
      name: 'refuses a misspelt changelog storage',
      run: () => {
        try {
          changelogStorageOf('versioning:\n  changelog:\n    storage: repostiory\n')
        } catch (error) {
          if (error instanceof ChangelogStorageInvalid && error.found === 'repostiory') return
          throw error
        }
        throw new Error('accepted a misspelt storage')
      },
    },
    {
      name: 'reads repository storage',
      run: () => {
        const found = changelogStorageOf('versioning:\n  changelog:\n    storage: repository\n')
        if (found !== 'repository') throw new Error(found)
      },
    },
  ]

  let failures = 0
  for (const test of cases) {
    try {
      test.run()
      console.log(`  ✓ ${test.name}`)
    } catch (error) {
      console.error(`  ✗ ${test.name}: ${error instanceof Error ? error.message : String(error)}`)
      failures++
    }
  }

  if (failures > 0) {
    console.error(`check-changelog-sections: selftest FAILED (${failures}/${cases.length})`)
    return 1
  }
  console.log(`check-changelog-sections: selftest ok (${cases.length} tests)`)
  return 0
}

const readOrNull = (path: string): Promise<string | null> => Deno.readTextFile(path).catch(() => null)

const main = async (): Promise<number> => {
  if (Deno.args.includes('--selftest')) return selftest()

  const storage = changelogStorageOf(await Deno.readTextFile(WORKSPACE_MANIFEST))
  const members = await publicMembers()
  if (members.length === 0) throw new Error('pnpm ls -r found no publishable workspace package')
  const violations: string[] = []
  for (const member of members) {
    const changelog = await readOrNull(join(member.dir, 'CHANGELOG.md'))
    violations.push(...sectionViolations(member.name, member.version, changelog))
  }
  const checked = members.length

  const parked: string[] = []
  for await (const entry of expandGlob(`${PARKED_DIRECTORY}/*.md`)) parked.push(entry.name)
  violations.push(...parkedViolations(storage, parked))

  if (violations.length > 0) {
    for (const violation of violations) console.error(`error[CHANGELOG-SECTIONS]: ${violation}`)
    console.error(`check-changelog-sections: ${violations.length} violation(s)`)
    return 1
  }
  console.log(
    `check-changelog-sections: ${checked} publishable package(s) each carry exactly one section for their version, and no section is parked`,
  )
  return 0
}

if (import.meta.main) {
  try {
    Deno.exit(await main())
  } catch (error) {
    console.error(`check-changelog-sections: error: ${error instanceof Error ? error.message : String(error)}`)
    Deno.exit(1)
  }
}
