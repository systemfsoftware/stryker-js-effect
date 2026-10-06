#!/usr/bin/env -S deno run --allow-read
import { expandGlob } from '@std/fs/expand-glob'
import { parse } from '@std/yaml'

const WORKSPACE_MANIFEST = 'pnpm-workspace.yaml'
const PARKED_DIRECTORY = '.changeset/changelogs'

interface Workspace {
  readonly patterns: ReadonlyArray<string>
  readonly storage: unknown
}

const workspaceOf = (text: string): Workspace => {
  const document = parse(text) as {
    packages?: ReadonlyArray<string>
    versioning?: { changelog?: { storage?: unknown } }
  } | null
  return {
    patterns: document?.packages ?? [],
    storage: document?.versioning?.changelog?.storage,
  }
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

export const parkedViolations = (storage: unknown, parked: ReadonlyArray<string>): ReadonlyArray<string> =>
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

  const workspace = workspaceOf(await Deno.readTextFile(WORKSPACE_MANIFEST))
  const violations: string[] = []
  let checked = 0
  for (const pattern of workspace.patterns) {
    for await (const entry of expandGlob(`${pattern}/package.json`, { exclude: ['**/node_modules/**'] })) {
      const manifest = JSON.parse(await Deno.readTextFile(entry.path)) as {
        name?: string
        version?: string
        private?: boolean
      }
      if (manifest.private === true || manifest.name === undefined || manifest.version === undefined) continue
      checked++
      const changelog = await readOrNull(entry.path.replace(/package\.json$/, 'CHANGELOG.md'))
      violations.push(...sectionViolations(manifest.name, manifest.version, changelog))
    }
  }

  const parked: string[] = []
  for await (const entry of expandGlob(`${PARKED_DIRECTORY}/*.md`)) parked.push(entry.name)
  violations.push(...parkedViolations(workspace.storage, parked))

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
