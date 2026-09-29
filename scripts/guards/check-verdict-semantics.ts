#!/usr/bin/env -S deno run --allow-read --allow-run --allow-write=/tmp --allow-env

const dec = new TextDecoder()

const VERDICT_SEMANTICS_FILE = 'packages/stryker-js/src/verdict-semantics.ts'

const TRAILER_KEY = 'Verdict-Semantics'

const DECLARATION_LOG = `%H%x00%(trailers:key=${TRAILER_KEY},valueonly)%x00`

export type VerdictSemanticsDeclaration = 'changed' | 'unchanged'

const DECLARATIONS: ReadonlySet<string> = new Set(['changed', 'unchanged'])

export type VerdictSemanticsTrailer = {
  readonly commit: string
  readonly value: string
}

const VERSION = /export const VERDICT_SEMANTICS_VERSION\s*=\s*(\d+)/

const SOURCE_FILE = /\.(?:ts|tsx|mts|cts)$/

const TEST_DIRECTORY = /(?:^|\/)(?:__tests__|__mocks__|tests?)\//

const TEST_SUFFIX = /\.(?:test|spec)\.[cm]?tsx?$/

export type VerdictSemanticsResult = {
  readonly ok: boolean
  readonly surfaceFiles: readonly string[]
  readonly messages: readonly string[]
  readonly errors: readonly string[]
}

export type VerdictSemanticsInput = {
  readonly changedFiles: readonly string[]
  readonly surface: readonly string[]
  readonly baseVersion: number | undefined
  readonly headVersion: number | undefined
  readonly declarations: readonly VerdictSemanticsTrailer[]
}

export const isSurfaceSource = (path: string, surface: readonly string[]): boolean =>
  SOURCE_FILE.test(path) &&
  !TEST_DIRECTORY.test(path) &&
  !TEST_SUFFIX.test(path) &&
  surface.some((root) => path === root || path.startsWith(`${root}/`))

const SURFACE_LITERALS = /VERDICT_SEMANTICS_SURFACE\b[^=]*=\s*\[([^\]]*)\]/s

export const parseSurface = (source: string): readonly string[] => {
  const body = SURFACE_LITERALS.exec(source)?.[1]
  if (body === undefined) return []
  return (body.match(/'[^']+'/g) ?? []).map((literal) => literal.slice(1, -1))
}

export const parseVersion = (source: string): number | undefined => {
  const match = VERSION.exec(source)
  return match?.[1] === undefined ? undefined : Number.parseInt(match[1], 10)
}

const missingDeclarationDiagnostic = (files: readonly string[]): string =>
  [
    'error[VERDICT-SEMANTICS]: a verdict-semantics surface file changed without a declaration',
    ...files.map((file) => `  --> ${file}`),
    'help: every file that produces or interprets a mutant verdict is on the verdict-semantics surface',
    '      (`VERDICT_SEMANTICS_SURFACE` in packages/stryker-js/src/verdict-semantics.ts). A change',
    '      there can alter which status a mutant receives, and R6 forbids merging one undeclared.',
    'remediation:',
    '  1. state the intent in the footer of a commit on this branch:',
    `     \`${TRAILER_KEY}: unchanged\` when no status can change, or`,
    `     \`${TRAILER_KEY}: changed\` when one can,`,
    `     e.g. \`git commit --amend --trailer '${TRAILER_KEY}: unchanged'\`.`,
    '  2. for `changed`, also bump `VERDICT_SEMANTICS_VERSION` in packages/stryker-js/src/verdict-semantics.ts.',
    '',
  ].join('\n')

const unbumpedDiagnostic = (base: number | undefined, head: number | undefined): string =>
  [
    `error[VERDICT-SEMANTICS]: a commit declares ${TRAILER_KEY}: changed but VERDICT_SEMANTICS_VERSION did not move`,
    `  base: ${base ?? '(absent)'}, head: ${head ?? '(absent)'}`,
    'help: the declaration promises a status change; the constant is how the verdict cache and the',
    '      cold-run backstop see that promise. An unmoved constant lets a stale cache be reused.',
    'remediation: raise VERDICT_SEMANTICS_VERSION in packages/stryker-js/src/verdict-semantics.ts',
    `             above ${base ?? 0}.`,
    '',
  ].join('\n')

const contradictionDiagnostic = (base: number | undefined, head: number | undefined): string =>
  [
    `error[VERDICT-SEMANTICS]: a commit declares ${TRAILER_KEY}: unchanged but VERDICT_SEMANTICS_VERSION moved`,
    `  base: ${base ?? '(absent)'}, head: ${head ?? '(absent)'}`,
    'help: the declaration promises no status can change, and a moved constant invalidates every',
    '      cached verdict and costs a cold run of the dogfood suite with nothing to explain it.',
    `remediation: declare \`${TRAILER_KEY}: changed\`, or leave the constant alone.`,
    '',
  ].join('\n')

const conflictDiagnostic = (declarations: readonly VerdictSemanticsTrailer[]): string =>
  [
    `error[VERDICT-SEMANTICS]: the branch declares two different verdict semantics in ${TRAILER_KEY} trailers`,
    ...declarations.map((declaration) => `  --> ${declaration.commit.slice(0, 12)} declares ${declaration.value}`),
    'help: one branch states one verdict semantics, so the constant bump and the cache invalidation',
    '      that the trailer promises stay unambiguous.',
    'remediation: keep a single trailer, e.g. amend or rebase away the commit that states the other.',
    '',
  ].join('\n')

const invalidDeclarationDiagnostic = (declaration: VerdictSemanticsTrailer): string =>
  [
    `error[VERDICT-SEMANTICS]: ${declaration.commit.slice(0, 12)} declares an unknown verdict semantics`,
    `  ${TRAILER_KEY}: ${declaration.value}`,
    `remediation: declare \`${TRAILER_KEY}: changed\` or \`${TRAILER_KEY}: unchanged\`.`,
    '',
  ].join('\n')

const isDeclaration = (value: string): value is VerdictSemanticsDeclaration => DECLARATIONS.has(value)

export const parseDeclarations = (log: string): readonly VerdictSemanticsTrailer[] => {
  const fields = log.split('\u0000')
  const declarations: VerdictSemanticsTrailer[] = []
  for (let index = 0; index + 1 < fields.length; index += 2) {
    const commit = (fields[index] ?? '').trim()
    for (const line of (fields[index + 1] ?? '').split('\n')) {
      const value = line.trim().toLowerCase()
      if (value.length > 0) declarations.push({ commit, value })
    }
  }
  return declarations
}

export const resolveDeclaration = (
  declarations: readonly VerdictSemanticsTrailer[],
): { readonly declaration: VerdictSemanticsDeclaration | undefined; readonly errors: readonly string[] } => {
  const invalid = declarations.filter((declaration) => !isDeclaration(declaration.value))
  const valid = declarations.flatMap((declaration) =>
    isDeclaration(declaration.value) ? [{ commit: declaration.commit, value: declaration.value }] : []
  )
  const representatives: { readonly commit: string; readonly value: VerdictSemanticsDeclaration }[] = []
  for (const declaration of valid) {
    if (!representatives.some((entry) => entry.value === declaration.value)) representatives.push(declaration)
  }
  const errors: string[] = invalid.map(invalidDeclarationDiagnostic)
  if (representatives.length > 1) errors.push(conflictDiagnostic(representatives))
  const single = representatives.length === 1 ? representatives[0] : undefined
  return { declaration: single?.value, errors }
}

export const inspectVerdictSemantics = (input: VerdictSemanticsInput): VerdictSemanticsResult => {
  const surfaceFiles = input.changedFiles.filter((file) => isSurfaceSource(file, input.surface))
  const bumped = input.headVersion !== undefined &&
    (input.baseVersion === undefined || input.headVersion > input.baseVersion)
  const resolved = resolveDeclaration(input.declarations)
  const errors = [...resolved.errors]
  if (surfaceFiles.length > 0 && resolved.declaration === undefined) {
    errors.push(missingDeclarationDiagnostic(surfaceFiles))
  }
  if (resolved.declaration === 'changed' && !bumped) {
    errors.push(unbumpedDiagnostic(input.baseVersion, input.headVersion))
  }
  if (resolved.declaration === 'unchanged' && bumped) {
    errors.push(contradictionDiagnostic(input.baseVersion, input.headVersion))
  }
  return {
    ok: errors.length === 0,
    surfaceFiles,
    messages: [
      `compared ${input.changedFiles.length} changed file(s), ${surfaceFiles.length} on the verdict-semantics surface`,
      `declaration: ${resolved.declaration ?? '(none)'}`,
    ],
    errors,
  }
}

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

const unquote = (path: string): string => path.startsWith('"') && path.endsWith('"') ? path.slice(1, -1) : path

const workingTreePaths = (porcelain: string): readonly string[] =>
  porcelain.split('\n').flatMap((line) => {
    const entry = line.trim()
    if (entry.length < 4) return []
    const renamed = entry.slice(2).trim().split(' -> ')
    return [unquote(renamed[renamed.length - 1] ?? '')]
  })

export const changedFilesOf = async (cwd: string, base: string, head: string): Promise<readonly string[]> => {
  const committed = (await tryGit(cwd, ['diff', '--name-only', base, head])) ?? ''
  const working = (await tryGit(cwd, ['status', '--porcelain', '--untracked-files=all'])) ?? ''
  const paths = [...committed.split('\n'), ...workingTreePaths(working)]
    .map((path) => path.trim())
    .filter((path) => path.length > 0)
  return [...new Set(paths)].sort()
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

const declarationsOf = async (cwd: string, base: string, head: string): Promise<readonly VerdictSemanticsTrailer[]> =>
  parseDeclarations(await git(cwd, ['log', `--format=${DECLARATION_LOG}`, `${base}..${head}`]))

export const checkVerdictSemantics = async (options: {
  readonly cwd: string
  readonly baseSha?: string | undefined
  readonly headSha?: string | undefined
}): Promise<VerdictSemanticsResult> => {
  const cwd = options.cwd
  const headSha = (await git(cwd, ['rev-parse', options.headSha ?? 'HEAD'])).trim()
  let base = options.baseSha !== undefined
    ? (await git(cwd, ['rev-parse', options.baseSha])).trim()
    : await resolveBase(cwd, headSha)

  if (base === undefined) {
    return {
      ok: true,
      surfaceFiles: [],
      messages: ['no merge base with origin/main; nothing to compare'],
      errors: [],
    }
  }

  if (base === headSha) {
    const parent = await tryGit(cwd, ['rev-parse', `${headSha}^1`])
    if (parent === undefined) {
      return {
        ok: true,
        surfaceFiles: [],
        messages: ['base equals HEAD and the commit has no parent; nothing to compare'],
        errors: [],
      }
    }
    base = parent.trim()
  }

  const headSource = (await readText(`${cwd}/${VERDICT_SEMANTICS_FILE}`)) ?? ''
  const baseSource = (await tryGit(cwd, ['show', `${base}:${VERDICT_SEMANTICS_FILE}`])) ?? ''
  const surface = [...new Set([...parseSurface(headSource), ...parseSurface(baseSource)])].sort()

  return inspectVerdictSemantics({
    changedFiles: await changedFilesOf(cwd, base, headSha),
    surface,
    baseVersion: parseVersion(baseSource),
    headVersion: parseVersion(headSource),
    declarations: await declarationsOf(cwd, base, headSha),
  })
}

const check = (condition: boolean, message: string): void => {
  if (!condition) throw new Error(message)
}

const SURFACE = ['packages/stryker-js', 'packages/ignorers']

const COMMIT_A = '1'.repeat(40)
const COMMIT_B = '2'.repeat(40)
const COMMIT_C = '3'.repeat(40)

const trailer = (commit: string, value: string): VerdictSemanticsTrailer => ({ commit, value })

const INSPECT_CASES: readonly {
  readonly name: string
  readonly input: VerdictSemanticsInput
  readonly ok: boolean
  readonly names?: string
}[] = [
  {
    name: 'a surface source change with no declaration fails and names the file',
    input: {
      changedFiles: ['packages/stryker-js/src/compare-verdicts.workflow.ts'],
      surface: SURFACE,
      baseVersion: 1,
      headVersion: 1,
      declarations: [],
    },
    ok: false,
    names: 'packages/stryker-js/src/compare-verdicts.workflow.ts',
  },
  {
    name: 'the same change passes when a commit declares the unchanged trailer',
    input: {
      changedFiles: ['packages/stryker-js/src/compare-verdicts.workflow.ts'],
      surface: SURFACE,
      baseVersion: 1,
      headVersion: 1,
      declarations: [trailer(COMMIT_A, 'unchanged')],
    },
    ok: true,
  },
  {
    name: 'a change outside the surface passes with no declaration',
    input: {
      changedFiles: ['packages/stryker-js-cli-contract/src/SpanTaxonomy.ts', 'docs/plan.md'],
      surface: SURFACE,
      baseVersion: 1,
      headVersion: 1,
      declarations: [],
    },
    ok: true,
  },
  {
    name: 'a test file inside a surface package passes with no declaration',
    input: {
      changedFiles: [
        'packages/stryker-js/src/__tests__/compare-verdicts.workflow.property.test.ts',
        'packages/stryker-js/tests/incremental-reuse.integration.test.ts',
        'packages/ignorers/x/src/mutator.test.ts',
      ],
      surface: SURFACE,
      baseVersion: 1,
      headVersion: 1,
      declarations: [],
    },
    ok: true,
  },
  {
    name: 'the changed trailer without a bumped constant fails',
    input: {
      changedFiles: [],
      surface: SURFACE,
      baseVersion: 1,
      headVersion: 1,
      declarations: [trailer(COMMIT_A, 'changed')],
    },
    ok: false,
    names: 'did not move',
  },
  {
    name: 'the changed trailer with a bumped constant passes',
    input: {
      changedFiles: [],
      surface: SURFACE,
      baseVersion: 1,
      headVersion: 2,
      declarations: [trailer(COMMIT_A, 'changed')],
    },
    ok: true,
  },
  {
    name: 'the changed trailer passes when the branch introduces the constant',
    input: {
      changedFiles: [],
      surface: SURFACE,
      baseVersion: undefined,
      headVersion: 1,
      declarations: [trailer(COMMIT_A, 'changed')],
    },
    ok: true,
  },
  {
    name: 'the changed trailer fails when the constant is gone at head',
    input: {
      changedFiles: [],
      surface: SURFACE,
      baseVersion: 1,
      headVersion: undefined,
      declarations: [trailer(COMMIT_A, 'changed')],
    },
    ok: false,
    names: 'did not move',
  },
  {
    name: 'the unchanged trailer with a bumped constant fails',
    input: {
      changedFiles: [],
      surface: SURFACE,
      baseVersion: 1,
      headVersion: 2,
      declarations: [trailer(COMMIT_A, 'unchanged')],
    },
    ok: false,
    names: 'moved',
  },
  {
    name: 'a surface change and a bumped constant with the unchanged trailer still fails',
    input: {
      changedFiles: ['packages/ignorers/x/src/a.ts'],
      surface: SURFACE,
      baseVersion: 3,
      headVersion: 4,
      declarations: [trailer(COMMIT_A, 'unchanged')],
    },
    ok: false,
    names: 'moved',
  },
  {
    name: 'two commits declaring different semantics fail and name both',
    input: {
      changedFiles: [],
      surface: SURFACE,
      baseVersion: 1,
      headVersion: 2,
      declarations: [trailer(COMMIT_A, 'changed'), trailer(COMMIT_B, 'unchanged')],
    },
    ok: false,
    names: COMMIT_B.slice(0, 12),
  },
  {
    name: 'two commits declaring the same semantics are not a conflict',
    input: {
      changedFiles: [],
      surface: SURFACE,
      baseVersion: 1,
      headVersion: 2,
      declarations: [trailer(COMMIT_A, 'changed'), trailer(COMMIT_B, 'changed')],
    },
    ok: true,
  },
  {
    name: 'an unknown trailer value fails and names the commit',
    input: {
      changedFiles: [],
      surface: SURFACE,
      baseVersion: 1,
      headVersion: 1,
      declarations: [trailer(COMMIT_C, 'maybe')],
    },
    ok: false,
    names: COMMIT_C.slice(0, 12),
  },
]

const seedRepo = async (dir: string, surfaceSource: string, version: number): Promise<string> => {
  await git(dir, ['init', '-q'])
  await git(dir, ['config', 'user.email', 'guard@test.invalid'])
  await git(dir, ['config', 'user.name', 'guard selftest'])
  await writeFile(dir, VERDICT_SEMANTICS_FILE, surfaceSource.replace('VERSION_PLACEHOLDER', String(version)))
  await git(dir, ['add', '-A'])
  await git(dir, ['commit', '-qm', 'init'])
  return (await git(dir, ['rev-parse', 'HEAD'])).trim()
}

const writeFile = async (dir: string, relative: string, contents: string): Promise<void> => {
  const full = `${dir}/${relative}`
  await Deno.mkdir(full.slice(0, full.lastIndexOf('/')), { recursive: true })
  await Deno.writeTextFile(full, contents)
}

const withRepo = async (body: (dir: string) => Promise<void>): Promise<void> => {
  const dir = await Deno.makeTempDir({ prefix: 'verdict-semantics-' })
  try {
    await body(dir)
  } finally {
    await Deno.remove(dir, { recursive: true })
  }
}

const SURFACE_SOURCE = `export const VERDICT_SEMANTICS_SURFACE: readonly string[] = [
  'packages/stryker-js',
  'packages/ignorers',
]

export const VERDICT_SEMANTICS_VERSION = VERSION_PLACEHOLDER
`

const selftest = async (): Promise<number> => {
  const tests: { name: string; run: () => Promise<void> | void }[] = [
    ...INSPECT_CASES.map((test) => ({
      name: test.name,
      run: () => {
        const result = inspectVerdictSemantics(test.input)
        const names = test.names
        check(result.ok === test.ok, `expected ok=${test.ok}, got ${result.ok}: ${JSON.stringify(result.errors)}`)
        check(
          names === undefined || result.errors.some((error) => error.includes(names)),
          `expected a diagnostic naming ${names}: ${JSON.stringify(result.errors)}`,
        )
      },
    })),
    {
      name: 'reads the surface and the constant out of the verdict-semantics source',
      run: () => {
        const surface = parseSurface(SURFACE_SOURCE)
        check(surface.length === 2, `expected 2 roots, got ${JSON.stringify(surface)}`)
        check(surface.includes('packages/ignorers'), `expected the ignorers root: ${JSON.stringify(surface)}`)
        check(parseVersion(SURFACE_SOURCE) === undefined, 'the placeholder must not parse as a version')
        check(parseVersion(SURFACE_SOURCE.replace('VERSION_PLACEHOLDER', '7')) === 7, 'expected 7')
      },
    },
    {
      name: 'parses commits and values out of the trailer log',
      run: () => {
        const log = `${COMMIT_A}\u0000changed\n\u0000\n${COMMIT_B}\u0000unchanged\n\u0000\n${COMMIT_C}\u0000\u0000\n`
        const parsed = parseDeclarations(log)
        check(parsed.length === 2, `expected 2 declarations, got ${JSON.stringify(parsed)}`)
        check(parsed[0]?.commit === COMMIT_A, `expected the first commit: ${JSON.stringify(parsed)}`)
        check(parsed[0]?.value === 'changed', `expected changed: ${JSON.stringify(parsed)}`)
        check(parsed[1]?.commit === COMMIT_B, `expected the second commit: ${JSON.stringify(parsed)}`)
        check(parsed[1]?.value === 'unchanged', `expected unchanged: ${JSON.stringify(parsed)}`)
      },
    },
    {
      name: 'a commit with two trailers contributes both values',
      run: () => {
        const parsed = parseDeclarations(`${COMMIT_A}\u0000changed\nunchanged\n\u0000\n`)
        check(parsed.length === 2, `expected both values: ${JSON.stringify(parsed)}`)
        check(parsed.every((declaration) => declaration.commit === COMMIT_A), 'both values come from one commit')
      },
    },
    {
      name: 'commits without a trailer contribute nothing',
      run: () => {
        check(parseDeclarations(`${COMMIT_C}\u0000\u0000\n`).length === 0, 'expected no declarations')
        check(parseDeclarations('').length === 0, 'expected no declarations')
      },
    },
    {
      name: 'a committed surface change without a trailer fails',
      run: async () => {
        await withRepo(async (dir) => {
          const base = await seedRepo(dir, SURFACE_SOURCE, 1)
          await writeFile(dir, 'packages/stryker-js/src/route.ts', 'export const a = 1\n')
          await git(dir, ['add', '-A'])
          await git(dir, ['commit', '-qm', 'touch the surface'])
          const result = await checkVerdictSemantics({ cwd: dir, baseSha: base, headSha: 'HEAD' })
          check(!result.ok, 'expected failure without a declaration')
          check(
            result.errors.some((error) => error.includes('packages/stryker-js/src/route.ts')),
            `diagnostic must name the changed file: ${JSON.stringify(result.errors)}`,
          )
        })
      },
    },
    {
      name: 'the same committed change passes with the unchanged trailer',
      run: async () => {
        await withRepo(async (dir) => {
          const base = await seedRepo(dir, SURFACE_SOURCE, 1)
          await writeFile(dir, 'packages/stryker-js/src/route.ts', 'export const a = 1\n')
          await git(dir, ['add', '-A'])
          await git(dir, ['commit', '-qm', 'touch the surface', '--trailer', `${TRAILER_KEY}: unchanged`])
          const result = await checkVerdictSemantics({ cwd: dir, baseSha: base, headSha: 'HEAD' })
          check(result.ok, `expected pass: ${JSON.stringify(result.errors)}`)
        })
      },
    },
    {
      name: 'a trailer on the base commit does not cover a later surface change',
      run: async () => {
        await withRepo(async (dir) => {
          await seedRepo(dir, SURFACE_SOURCE, 1)
          await git(dir, ['commit', '--amend', '-qm', 'init', '--trailer', `${TRAILER_KEY}: unchanged`])
          const base = (await git(dir, ['rev-parse', 'HEAD'])).trim()
          await writeFile(dir, 'packages/stryker-js/src/route.ts', 'export const a = 1\n')
          await git(dir, ['add', '-A'])
          await git(dir, ['commit', '-qm', 'touch the surface'])
          const result = await checkVerdictSemantics({ cwd: dir, baseSha: base, headSha: 'HEAD' })
          check(!result.ok, `the base trailer is outside base..head: ${JSON.stringify(result.errors)}`)
        })
      },
    },
    {
      name: 'the changed trailer needs a bumped constant, and passes once it moves',
      run: async () => {
        await withRepo(async (dir) => {
          const base = await seedRepo(dir, SURFACE_SOURCE, 1)
          await writeFile(dir, 'packages/stryker-js/src/route.ts', 'export const a = 1\n')
          await git(dir, ['add', '-A'])
          await git(dir, ['commit', '-qm', 'declare a semantics change', '--trailer', `${TRAILER_KEY}: changed`])
          const refused = await checkVerdictSemantics({ cwd: dir, baseSha: base, headSha: 'HEAD' })
          check(!refused.ok, 'expected failure without a bump')

          await writeFile(dir, VERDICT_SEMANTICS_FILE, SURFACE_SOURCE.replace('VERSION_PLACEHOLDER', '2'))
          await git(dir, ['add', '-A'])
          await git(dir, ['commit', '-qm', 'bump the constant'])
          const accepted = await checkVerdictSemantics({ cwd: dir, baseSha: base, headSha: 'HEAD' })
          check(accepted.ok, `expected pass with the bump: ${JSON.stringify(accepted.errors)}`)
        })
      },
    },
    {
      name: 'two commits declaring different semantics fail and name both',
      run: async () => {
        await withRepo(async (dir) => {
          const base = await seedRepo(dir, SURFACE_SOURCE, 1)
          await writeFile(dir, 'packages/stryker-js/src/route.ts', 'export const a = 1\n')
          await writeFile(dir, VERDICT_SEMANTICS_FILE, SURFACE_SOURCE.replace('VERSION_PLACEHOLDER', '2'))
          await git(dir, ['add', '-A'])
          await git(dir, ['commit', '-qm', 'declare changed', '--trailer', `${TRAILER_KEY}: changed`])
          const changed = (await git(dir, ['rev-parse', 'HEAD'])).trim()
          await writeFile(dir, 'packages/stryker-js/src/route2.ts', 'export const b = 2\n')
          await git(dir, ['add', '-A'])
          await git(dir, ['commit', '-qm', 'declare unchanged', '--trailer', `${TRAILER_KEY}: unchanged`])
          const unchanged = (await git(dir, ['rev-parse', 'HEAD'])).trim()
          const result = await checkVerdictSemantics({ cwd: dir, baseSha: base, headSha: 'HEAD' })
          check(!result.ok, 'expected a conflict')
          check(
            result.errors.some((error) =>
              error.includes(changed.slice(0, 12)) && error.includes(unchanged.slice(0, 12))
            ),
            `diagnostic must name both commits: ${JSON.stringify(result.errors)}`,
          )
        })
      },
    },
    {
      name: 'an unknown trailer value fails and names the commit',
      run: async () => {
        await withRepo(async (dir) => {
          const base = await seedRepo(dir, SURFACE_SOURCE, 1)
          await writeFile(dir, 'packages/stryker-js/src/route.ts', 'export const a = 1\n')
          await git(dir, ['add', '-A'])
          await git(dir, ['commit', '-qm', 'declare something else', '--trailer', `${TRAILER_KEY}: maybe`])
          const head = (await git(dir, ['rev-parse', 'HEAD'])).trim()
          const result = await checkVerdictSemantics({ cwd: dir, baseSha: base, headSha: 'HEAD' })
          check(!result.ok, 'expected failure')
          check(
            result.errors.some((error) => error.includes(head.slice(0, 12))),
            `diagnostic must name the commit: ${JSON.stringify(result.errors)}`,
          )
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
    console.error(`check-verdict-semantics: selftest FAILED (${failures}/${tests.length})`)
    return 1
  }
  console.log(`check-verdict-semantics: selftest ok (${tests.length} tests)`)
  return 0
}

const main = async (): Promise<number> => {
  if (Deno.args.includes('--selftest')) return await selftest()

  const result = await checkVerdictSemantics({ cwd: Deno.cwd(), baseSha: Deno.args[0], headSha: Deno.args[1] })
  for (const message of result.messages) console.log(message)
  for (const error of result.errors) console.error(error)
  return result.ok ? 0 : 1
}

if (import.meta.main) {
  try {
    Deno.exit(await main())
  } catch (error) {
    console.error(`check-verdict-semantics: error: ${error instanceof Error ? error.message : String(error)}`)
    Deno.exit(1)
  }
}
