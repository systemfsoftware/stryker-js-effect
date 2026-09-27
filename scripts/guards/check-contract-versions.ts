#!/usr/bin/env -S deno run --allow-read --allow-run --allow-write=/tmp --allow-env
import { type ChangeIntent, collectChangesetIntents } from '../lib/changeset-intents.ts'
import { classifyDocument, type ContractKind, majorOf, streamVersionOf } from '../lib/contract-compat.ts'

const dec = new TextDecoder()

export type ContractVersionResult = {
  readonly ok: boolean
  readonly compared: number
  readonly messages: readonly string[]
  readonly errors: readonly string[]
}

const KIND_BY_BASENAME: Record<string, ContractKind> = {
  'stream.schema.json': 'json-schema',
  'report.schema.json': 'json-schema',
  'stock-catalog.json': 'catalog',
  'span-taxonomy.json': 'taxonomy',
}

const CONTRACT_DOCUMENT = /^packages\/[^/]+\/contract\/[^/]+\.json$/

const basenameOf = (path: string): string => path.slice(path.lastIndexOf('/') + 1)

const packageDirOf = (path: string): string => path.split('/')[1] ?? ''

const git = async (cwd: string, args: readonly string[]): Promise<string> => {
  const command = new Deno.Command('git', { args: [...args], cwd, stdout: 'piped', stderr: 'piped' })
  const output = await command.output()
  if (!output.success) {
    throw new Error(`git ${args.join(' ')} failed: ${dec.decode(output.stderr).trim()}`)
  }
  return dec.decode(output.stdout)
}

const tryGit = async (cwd: string, args: readonly string[]): Promise<string | undefined> => {
  try {
    return await git(cwd, args)
  } catch {
    return undefined
  }
}

const readText = async (path: string): Promise<string | undefined> => {
  try {
    return await Deno.readTextFile(path)
  } catch {
    return undefined
  }
}

const parseJson = (text: string | undefined): unknown => {
  if (text === undefined) return undefined
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

const listHeadDocuments = async (cwd: string): Promise<readonly string[]> => {
  const paths: string[] = []
  const packages: string[] = []
  try {
    for await (const entry of Deno.readDir(`${cwd}/packages`)) {
      if (entry.isDirectory) packages.push(entry.name)
    }
  } catch {
    return paths
  }
  for (const name of packages.sort()) {
    try {
      for await (const entry of Deno.readDir(`${cwd}/packages/${name}/contract`)) {
        if (entry.isFile && entry.name.endsWith('.json')) paths.push(`packages/${name}/contract/${entry.name}`)
      }
    } catch {
      continue
    }
  }
  return paths.sort()
}

const listBaseDocuments = async (cwd: string, base: string): Promise<readonly string[]> => {
  const listing = await tryGit(cwd, ['ls-tree', '-r', '--name-only', base])
  if (listing === undefined) return []
  return listing
    .split('\n')
    .map((line) => line.trim())
    .filter((path) => CONTRACT_DOCUMENT.test(path))
    .sort()
}

const resolveBase = async (cwd: string, headSha: string): Promise<string | undefined> => {
  const mergeBase = await tryGit(cwd, ['merge-base', 'origin/main', headSha])
  if (mergeBase !== undefined) return mergeBase.trim()
  await tryGit(cwd, ['fetch', '--quiet', 'origin', 'main'])
  const retried = await tryGit(cwd, ['merge-base', 'origin/main', headSha])
  if (retried !== undefined) return retried.trim()
  const parent = await tryGit(cwd, ['rev-parse', `${headSha}~1`])
  return parent?.trim()
}

type PackageInfo = { readonly name?: string; readonly version?: string }

const parsePackageInfo = (text: string | undefined): PackageInfo => {
  const parsed = parseJson(text)
  if (typeof parsed !== 'object' || parsed === null) return {}
  const record = parsed as Record<string, unknown>
  return {
    name: typeof record.name === 'string' ? record.name : undefined,
    version: typeof record.version === 'string' ? record.version : undefined,
  }
}

export const checkContractVersions = async (options: {
  readonly cwd: string
  readonly baseSha?: string | undefined
  readonly headSha?: string | undefined
}): Promise<ContractVersionResult> => {
  const cwd = options.cwd
  const messages: string[] = []
  const errors: string[] = []

  const headSha = (await git(cwd, ['rev-parse', options.headSha ?? 'HEAD'])).trim()
  let base = options.baseSha !== undefined
    ? (await git(cwd, ['rev-parse', options.baseSha])).trim()
    : await resolveBase(cwd, headSha)

  if (base === undefined) {
    messages.push('no merge base with origin/main; nothing to compare', 'compared 0 contract document(s)')
    return { ok: true, compared: 0, messages, errors }
  }

  if (base === headSha) {
    const parent = await tryGit(cwd, ['rev-parse', `${headSha}^1`])
    if (parent === undefined) {
      messages.push(
        'base equals HEAD and the commit has no parent; nothing to compare',
        'compared 0 contract document(s)',
      )
      return { ok: true, compared: 0, messages, errors }
    }
    base = parent.trim()
    messages.push(`base equals HEAD; comparing first parent ${base.slice(0, 7)} with HEAD`)
  }

  const headDocuments = await listHeadDocuments(cwd)
  const baseDocuments = await listBaseDocuments(cwd, base)
  const documents = [...new Set([...baseDocuments, ...headDocuments])].sort()
  const intents: readonly ChangeIntent[] = await collectChangesetIntents(`${cwd}/.changeset`)

  for (const path of documents) {
    const kind = KIND_BY_BASENAME[basenameOf(path)] ?? 'json-schema'
    const before = parseJson(await tryGit(cwd, ['show', `${base}:${path}`]))
    const after = parseJson(await readText(`${cwd}/${path}`))
    const incompatibilities = classifyDocument(kind, before, after)
    if (incompatibilities.length === 0) continue

    const packageDir = packageDirOf(path)
    const headInfo = parsePackageInfo(await readText(`${cwd}/packages/${packageDir}/package.json`))
    const baseInfo = parsePackageInfo(await tryGit(cwd, ['show', `${base}:packages/${packageDir}/package.json`]))
    const packageName = headInfo.name ?? baseInfo.name
    const version = headInfo.version ?? baseInfo.version
    const acceptable = version !== undefined && majorOf(version) > 0 ? ['major'] : ['minor', 'major']

    const problems: string[] = []
    if (packageName === undefined) {
      problems.push(`no package.json name in packages/${packageDir}; cannot map the change to a changeset intent`)
    } else if (!intents.some((intent) => intent.package === packageName && acceptable.includes(intent.bump))) {
      problems.push(`no changeset intent names ${packageName} with a ${acceptable.join(' or ')} bump`)
    }

    if (
      kind === 'json-schema' && basenameOf(path) === 'stream.schema.json' && before !== undefined && before !== null
    ) {
      const baseVersion = streamVersionOf(before)
      const headVersion = streamVersionOf(after)
      const baseMajor = baseVersion !== undefined ? majorOf(baseVersion) : undefined
      const headMajor = headVersion !== undefined ? majorOf(headVersion) : undefined
      if (baseMajor !== undefined && (headMajor === undefined || headMajor <= baseMajor)) {
        problems.push(
          `stream version is ${
            headVersion ?? 'absent'
          } but the base declared ${baseVersion}; a breaking stream change requires a major stream-version bump`,
        )
      }
    }

    if (problems.length === 0) continue

    errors.push(
      [
        `error[CONTRACT-VERSION]: incompatible contract change in ${path}`,
        `  package: ${packageName ?? packageDir}${version !== undefined ? `@${version}` : ''}`,
        ...incompatibilities.map((entry) => `  --> ${entry.pointer === '' ? '/' : entry.pointer}: ${entry.reason}`),
        ...problems.map((problem) => `  ! ${problem}`),
        `help: removing or narrowing a declared contract member breaks every consumer compiled against it.`,
        `remediation:`,
        `  1. author a changeset for ${packageName ?? packageDir} with a ${acceptable.join(' or ')} bump:`,
        `     pnpm change --bump ${acceptable[0]} --summary "<changelog entry>" ${packageName ?? packageDir}`,
        `  2. for the stream schema, raise the major segment of the stream version it declares.`,
        ``,
      ].join('\n'),
    )
  }

  messages.push(`compared ${documents.length} contract document(s)`)
  return { ok: errors.length === 0, compared: documents.length, messages, errors }
}

const check = (condition: boolean, message: string): void => {
  if (!condition) throw new Error(message)
}

const writeFile = async (dir: string, relative: string, contents: string): Promise<void> => {
  const full = `${dir}/${relative}`
  await Deno.mkdir(full.slice(0, full.lastIndexOf('/')), { recursive: true })
  await Deno.writeTextFile(full, contents)
}

const commit = async (dir: string, message: string): Promise<string> => {
  await git(dir, ['add', '-A'])
  await git(dir, ['commit', '-qm', message])
  return (await git(dir, ['rev-parse', 'HEAD'])).trim()
}

const CATALOG_ENTRY = {
  id: 'arithmetic',
  name: 'ArithmeticOperator',
  tier: 'default',
  definition: { kind: 'binary' },
  examples: [{ before: '2 + 2', after: ['2 - 2'] }],
}

const streamDocument = (version: string, includePid: boolean) => ({
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $defs: {
    RunStart: {
      type: 'object',
      properties: {
        _tag: { const: 'runStart' },
        schemaVersion: { type: 'string', const: version },
        ...(includePid ? { pid: { type: 'integer' } } : {}),
      },
      required: ['_tag', 'schemaVersion'],
    },
  },
  anyOf: [{ $ref: '#/$defs/RunStart' }],
})

const PACKAGE = '@systemfsoftware/stryker-js-cli-contract'
const STREAM_PATH = 'packages/stryker-js-cli-contract/contract/stream.schema.json'
const CATALOG_PATH = 'packages/stryker-js-cli-contract/contract/stock-catalog.json'

const writeChangeset = (dir: string, file: string, intents: readonly [string, string][]): Promise<void> =>
  writeFile(
    dir,
    `.changeset/${file}`,
    `---\n${intents.map(([name, bump]) => `"${name}": ${bump}`).join('\n')}\n---\n\nbody\n`,
  )

const seedRepo = async (dir: string, options: { readonly version?: string; readonly contracts?: boolean } = {}) => {
  await git(dir, ['init', '-q'])
  await git(dir, ['config', 'user.email', 'guard@test.invalid'])
  await git(dir, ['config', 'user.name', 'guard selftest'])
  await writeFile(
    dir,
    'packages/stryker-js-cli-contract/package.json',
    JSON.stringify({ name: PACKAGE, version: options.version ?? '0.1.0' }),
  )
  await writeFile(dir, '.changeset/README.md', '# Changesets\n')
  if (options.contracts !== false) {
    await writeFile(dir, STREAM_PATH, JSON.stringify(streamDocument('1.1', true), null, 2))
    await writeFile(dir, CATALOG_PATH, JSON.stringify([CATALOG_ENTRY], null, 2))
  }
  return await commit(dir, 'init')
}

const withRepo = async (body: (dir: string) => Promise<void>): Promise<void> => {
  const dir = await Deno.makeTempDir({ prefix: 'contract-versions-' })
  try {
    await body(dir)
  } finally {
    await Deno.remove(dir, { recursive: true })
  }
}

const selftest = async (): Promise<number> => {
  const tests: { name: string; run: () => Promise<void> }[] = [
    {
      name: 'AE6: a removed stream field with a major intent but no stream bump fails',
      run: async () => {
        await withRepo(async (dir) => {
          const base = await seedRepo(dir)
          await writeFile(dir, STREAM_PATH, JSON.stringify(streamDocument('1.1', false), null, 2))
          await writeChangeset(dir, 'breaking.md', [[PACKAGE, 'major']])
          await commit(dir, 'breaking without stream bump')
          const result = await checkContractVersions({ cwd: dir, baseSha: base, headSha: 'HEAD' })
          check(!result.ok, 'expected failure without a stream-version bump')
          check(
            result.errors.some((error) =>
              error.includes('error[CONTRACT-VERSION]') && error.includes('property removed: pid') &&
              error.includes('stream version')
            ),
            `diagnostic must name the removed field and the missing stream bump: ${JSON.stringify(result.errors)}`,
          )
        })
      },
    },
    {
      name: 'AE6: the same change passes once the stream major is bumped',
      run: async () => {
        await withRepo(async (dir) => {
          const base = await seedRepo(dir)
          await writeFile(dir, STREAM_PATH, JSON.stringify(streamDocument('2.0', false), null, 2))
          await writeChangeset(dir, 'breaking.md', [[PACKAGE, 'major']])
          await commit(dir, 'breaking with stream bump')
          const result = await checkContractVersions({ cwd: dir, baseSha: base, headSha: 'HEAD' })
          check(result.ok, `expected pass with both bumps: ${JSON.stringify(result.errors)}`)
          check(result.compared === 2, `expected 2 documents compared, got ${result.compared}`)
        })
      },
    },
    {
      name: 'base equals HEAD compares the first parent with HEAD',
      run: async () => {
        await withRepo(async (dir) => {
          await seedRepo(dir)
          await writeFile(dir, STREAM_PATH, JSON.stringify(streamDocument('1.1', false), null, 2))
          await writeChangeset(dir, 'breaking.md', [[PACKAGE, 'major']])
          await commit(dir, 'breaking without stream bump')
          const result = await checkContractVersions({ cwd: dir, baseSha: 'HEAD', headSha: 'HEAD' })
          check(!result.ok, 'expected the first-parent comparison to fail')
          check(
            result.messages.some((message) => message.includes('base equals HEAD')),
            `expected the first-parent message: ${JSON.stringify(result.messages)}`,
          )
        })
      },
    },
    {
      name: 'base equals HEAD with no parent passes',
      run: async () => {
        await withRepo(async (dir) => {
          await seedRepo(dir)
          const result = await checkContractVersions({ cwd: dir, baseSha: 'HEAD', headSha: 'HEAD' })
          check(result.ok, 'a root commit has nothing to compare')
          check(result.compared === 0, `expected 0 documents compared, got ${result.compared}`)
        })
      },
    },
    {
      name: 'a 0.x package accepts a minor intent and refuses patch',
      run: async () => {
        await withRepo(async (dir) => {
          const base = await seedRepo(dir)
          await writeFile(dir, CATALOG_PATH, JSON.stringify([], null, 2))
          await writeChangeset(dir, 'minor.md', [[PACKAGE, 'minor']])
          await commit(dir, 'remove catalog entry')
          const minor = await checkContractVersions({ cwd: dir, baseSha: base, headSha: 'HEAD' })
          check(minor.ok, `0.x must accept a minor bump: ${JSON.stringify(minor.errors)}`)

          await writeChangeset(dir, 'minor.md', [[PACKAGE, 'patch']])
          const patch = await checkContractVersions({ cwd: dir, baseSha: base, headSha: 'HEAD' })
          check(!patch.ok, '0.x must refuse a patch-only intent')
          check(
            patch.errors.some((error) => error.includes('catalog entry removed: id "arithmetic"')),
            `diagnostic must name the removed catalog entry: ${JSON.stringify(patch.errors)}`,
          )
        })
      },
    },
    {
      name: 'a catalog removal with no intent fails',
      run: async () => {
        await withRepo(async (dir) => {
          const base = await seedRepo(dir)
          await writeFile(dir, CATALOG_PATH, JSON.stringify([], null, 2))
          await commit(dir, 'remove catalog entry')
          const result = await checkContractVersions({ cwd: dir, baseSha: base, headSha: 'HEAD' })
          check(!result.ok, 'expected failure without any intent')
          check(
            result.errors.some((error) => error.includes('no changeset intent names')),
            `diagnostic must demand a changeset: ${JSON.stringify(result.errors)}`,
          )
        })
      },
    },
    {
      name: 'a contract document absent at the base is compatible',
      run: async () => {
        await withRepo(async (dir) => {
          const base = await seedRepo(dir, { contracts: false })
          await writeFile(dir, STREAM_PATH, JSON.stringify(streamDocument('1.1', true), null, 2))
          await commit(dir, 'add stream contract')
          const result = await checkContractVersions({ cwd: dir, baseSha: base, headSha: 'HEAD' })
          check(result.ok, `a new document must be compatible: ${JSON.stringify(result.errors)}`)
          check(result.compared === 1, `expected 1 document compared, got ${result.compared}`)
        })
      },
    },
  ]

  let failures = 0
  for (const test of tests) {
    try {
      await test.run()
      console.log(`  ✓ ${test.name}`)
    } catch (error) {
      console.error(`  ✗ ${test.name}: ${error instanceof Error ? error.message : String(error)}`)
      failures++
    }
  }

  if (failures > 0) {
    console.error(`check-contract-versions: selftest FAILED (${failures}/${tests.length})`)
    return 1
  }
  console.log(`check-contract-versions: selftest ok (${tests.length} tests)`)
  return 0
}

const main = async (): Promise<number> => {
  if (Deno.args.includes('--selftest')) return await selftest()

  const result = await checkContractVersions({ cwd: Deno.cwd(), baseSha: Deno.args[0], headSha: Deno.args[1] })
  for (const message of result.messages) console.log(message)
  for (const error of result.errors) console.error(error)
  return result.ok ? 0 : 1
}

if (import.meta.main) {
  try {
    Deno.exit(await main())
  } catch (error) {
    console.error(`check-contract-versions: error: ${error instanceof Error ? error.message : String(error)}`)
    Deno.exit(1)
  }
}
