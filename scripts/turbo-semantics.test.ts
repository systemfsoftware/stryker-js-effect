import { assert, assertEqual } from './assert.ts'
import { cleanEnv, commit, git, PERMITTED_SCRATCH_DIR, type Ran, run, TURBO_PROGRAM, write } from './process.ts'

const REPO_ROOT = new URL('../', import.meta.url)

const TASKS = ['build', 'test']

const SCHEMA = 'https://v2-10-1.turborepo.dev/schema.json'

interface TaskEntry {
  readonly taskId: string
  readonly hash: string
}

const taskEntryOf = (value: unknown): TaskEntry | null => {
  if (typeof value !== 'object' || value === null) return null
  if (!('taskId' in value) || !('hash' in value)) return null
  const { taskId, hash } = value
  if (typeof taskId !== 'string' || typeof hash !== 'string') return null
  return { taskId, hash }
}

const tasksOf = (stdout: string): ReadonlyArray<TaskEntry> => {
  const parsed: unknown = JSON.parse(stdout)
  if (typeof parsed !== 'object' || parsed === null || !('tasks' in parsed) || !Array.isArray(parsed.tasks)) {
    throw new Error(`unexpected dry-run output: ${stdout.slice(0, 200)}`)
  }
  const entries: Array<TaskEntry> = []
  for (const raw of parsed.tasks) {
    const entry = taskEntryOf(raw)
    if (entry === null) throw new Error(`unexpected dry-run task: ${JSON.stringify(raw)}`)
    entries.push(entry)
  }
  return entries
}

const rootPackageJson = `{
  "name": "probe-root",
  "private": true,
  "packageManager": "pnpm@9.15.0",
  "scripts": { "root": "echo root" }
}
`

const rootTurboJson = (): string =>
  `{
  "$schema": "${SCHEMA}",
  "futureFlags": { "affectedUsingTaskInputs": true, "githubActionsRemoteBaseRefFallback": true },
  "tasks": {
    "//#root": {},
    "build": { "inputs": ["src/**"], "outputs": [] },
    "test": { "inputs": ["src/**"], "outputs": [] }
  }
}
`

const standInParentTurboJson = `{
  "$schema": "${SCHEMA}",
  "futureFlags": { "affectedUsingTaskInputs": true, "githubActionsRemoteBaseRefFallback": true },
  "tasks": {
    "//#root": {},
    "build": { "inputs": ["src/**"], "outputs": [] },
    "test": { "dependsOn": ["build"], "inputs": ["$TURBO_DEFAULT$", "!**/README.md"], "env": ["NODE_ENV"], "outputs": [] }
  }
}
`

const packageJson = (name: string): string =>
  `{
  "name": "${name}",
  "version": "0.0.0",
  "scripts": { "build": "echo build-${name}", "test": "echo test-${name}" }
}
`

const pnpmWorkspace = `packages:
  - packages/*
`

const lockfile = `lockfileVersion: '9.0'

settings:
  autoInstallPeers: true
  excludeLinksFromLockfile: false

importers:
  .: {}
  packages/a: {}
  packages/b: {}
`

interface FixtureOptions {
  readonly bTurboJson?: string
  readonly rootTurboJson?: string
}

const seedFixture = async (dir: string, options: FixtureOptions): Promise<void> => {
  await write(dir, 'package.json', rootPackageJson)
  await write(dir, 'pnpm-workspace.yaml', pnpmWorkspace)
  await write(dir, 'pnpm-lock.yaml', lockfile)
  await write(dir, 'turbo.json', options.rootTurboJson ?? rootTurboJson())
  await write(dir, 'packages/a/package.json', packageJson('@probe/a'))
  await write(dir, 'packages/a/src/index.js', 'export const a = 1\n')
  await write(dir, 'packages/b/package.json', packageJson('@probe/b'))
  await write(dir, 'packages/b/src/index.js', 'export const b = 1\n')
  await write(dir, 'shared.txt', 'shared\n')
  if (options.bTurboJson !== undefined) await write(dir, 'packages/b/turbo.json', options.bTurboJson)
}

const withRepo = async <A>(options: FixtureOptions, body: (dir: string) => Promise<A>): Promise<A> => {
  const dir = await Deno.makeTempDir({ dir: PERMITTED_SCRATCH_DIR, prefix: 'turbo-semantics-' })
  try {
    await git(dir, ['init', '-q', '-b', 'trunk', '.'])
    await seedFixture(dir, options)
    await commit(dir, 'fixture')
    return await body(dir)
  } finally {
    await Deno.remove(dir, { recursive: true })
  }
}

const turboRun = (dir: string, tasks: ReadonlyArray<string> = TASKS): Promise<Ran> =>
  run(TURBO_PROGRAM, ['run', ...tasks, '--dry=json', '--cwd', dir], REPO_ROOT, cleanEnv())

const dryRun = async (dir: string, tasks?: ReadonlyArray<string>): Promise<ReadonlyArray<TaskEntry>> => {
  const ran = await turboRun(dir, tasks)
  if (ran.code !== 0) throw new Error(`turbo run failed: ${ran.stderr}`)
  return tasksOf(ran.stdout)
}

const hashOf = async (dir: string, taskId: string): Promise<string> => {
  const tasks = await dryRun(dir)
  const task = tasks.find((candidate) => candidate.taskId === taskId)
  if (task === undefined) throw new Error(`task ${taskId} missing from dry run`)
  return task.hash
}

const tasksMovedBy = async (dir: string, edit: () => Promise<void>): Promise<Array<string>> => {
  const before = await dryRun(dir)
  await edit()
  const after = await dryRun(dir)
  return after
    .filter((task) => before.find((prior) => prior.taskId === task.taskId)?.hash !== task.hash)
    .map((task) => task.taskId)
    .sort()
}

interface ResolvedDefinition {
  readonly dependsOn: ReadonlyArray<string>
  readonly env: ReadonlyArray<string>
  readonly inputs: ReadonlyArray<string>
}

const stringsOf = (value: unknown, label: string): ReadonlyArray<string> => {
  if (!Array.isArray(value) || !value.every((item): item is string => typeof item === 'string')) {
    throw new Error(`unexpected ${label}: ${JSON.stringify(value)}`)
  }
  return value
}

const resolvedDefinitionOf = async (dir: string, taskId: string): Promise<ResolvedDefinition> => {
  const ran = await turboRun(dir)
  if (ran.code !== 0) throw new Error(`turbo run failed: ${ran.stderr}`)
  const parsed: unknown = JSON.parse(ran.stdout)
  if (typeof parsed !== 'object' || parsed === null || !('tasks' in parsed) || !Array.isArray(parsed.tasks)) {
    throw new Error(`unexpected dry-run output: ${ran.stdout.slice(0, 200)}`)
  }
  const task: unknown = parsed.tasks.find((raw: unknown) => taskEntryOf(raw)?.taskId === taskId)
  if (typeof task !== 'object' || task === null || !('resolvedTaskDefinition' in task)) {
    throw new Error(`task ${taskId} has no resolved definition`)
  }
  const definition = task.resolvedTaskDefinition
  if (typeof definition !== 'object' || definition === null) {
    throw new Error(`task ${taskId} definition is not an object`)
  }
  const field = (name: string): unknown => (name in definition ? Reflect.get(definition, name) : undefined)
  return {
    dependsOn: stringsOf(field('dependsOn'), `${taskId} dependsOn`),
    env: stringsOf(field('env'), `${taskId} env`),
    inputs: stringsOf(field('inputs'), `${taskId} inputs`),
  }
}

Deno.test("a root task's declared inputs, at the root or inside a package, move its hash", async () => {
  const rootTaskTurboJson = rootTurboJson().replace(
    '"//#root": {}',
    '"//#root": { "inputs": ["scripts/**", "packages/a/src/index.js"], "outputs": [] }',
  )
  await withRepo({ rootTurboJson: rootTaskTurboJson }, async (dir) => {
    const rootHash = async (): Promise<string> => {
      const task = (await dryRun(dir, ['root'])).find((candidate) => candidate.taskId === '//#root')
      if (task === undefined) throw new Error('//#root missing from dry run')
      return task.hash
    }
    await write(dir, 'scripts/check.ts', 'export const check = 1\n')
    await commit(dir, 'root script')
    for (
      const [path, content] of [
        ['scripts/check.ts', 'export const check = 2\n'],
        ['packages/a/src/index.js', 'export const a = 2\n'],
      ] as const
    ) {
      const before = await rootHash()
      await write(dir, path, content)
      assert(before !== (await rootHash()), `editing ${path} changes //#root's hash`)
    }
  })
})

Deno.test("a $TURBO_ROOT$ input moves the reader's hash while $TURBO_EXTENDS$ keeps the parent's dependsOn, env, inputs and negations", async () => {
  const bTurboJson = `{
  "extends": ["//"],
  "tasks": { "test": { "inputs": ["$TURBO_EXTENDS$", "$TURBO_ROOT$/shared.txt"] } }
}
`
  const fixture = { rootTurboJson: standInParentTurboJson, bTurboJson }
  await withRepo(fixture, async (dir) => {
    const extended = await resolvedDefinitionOf(dir, '@probe/b#test')
    assertEqual(
      [extended.dependsOn, extended.env],
      [['build'], ['NODE_ENV']],
      "the package keeps the parent's dependsOn and env",
    )
    const hashBefore = await hashOf(dir, '@probe/b#test')
    await write(dir, 'shared.txt', 'shared\nmore\n')
    const hashAfter = await hashOf(dir, '@probe/b#test')
    assert(hashBefore !== hashAfter, "editing a $TURBO_ROOT$ input changes the reader's hash")
  })
  await withRepo(fixture, async (dir) => {
    const moved = await tasksMovedBy(dir, () => write(dir, 'packages/b/src/index.js', 'export const b = 2\n'))
    assert(moved.includes('@probe/b#test'), "$TURBO_EXTENDS$ keeps the parent's $TURBO_DEFAULT$")
  })
  await withRepo(fixture, async (dir) => {
    const moved = await tasksMovedBy(dir, () => write(dir, 'packages/b/README.md', 'readme\n'))
    assertEqual(moved, [], "the parent's README negation still applies under extension")
  })
})

const rootReadTurboJson = (reads: ReadonlyArray<string>): string =>
  `{ "extends": ["//"], "tasks": { "test": { "inputs": ${JSON.stringify(['$TURBO_EXTENDS$', ...reads])} } } }\n`

Deno.test('a declared $TURBO_ROOT$ read of the lockfile or the workspace file moves only its reader, and an undeclared one moves nothing', async () => {
  for (const file of ['pnpm-lock.yaml', 'pnpm-workspace.yaml']) {
    for (const declared of [true, false]) {
      const bTurboJson = rootReadTurboJson(declared ? [`$TURBO_ROOT$/${file}`] : [])
      await withRepo({ bTurboJson }, async (dir) => {
        const moved = await tasksMovedBy(dir, async () => {
          await write(dir, file, `${await Deno.readTextFile(`${dir}/${file}`)}# probe\n`)
        })
        assertEqual(moved, declared ? ['@probe/b#test'] : [], `${file} ${declared ? 'declared' : 'undeclared'}`)
      })
    }
  }
})

Deno.test('$TURBO_ROOT$ glob reads match ** at any depth including zero and * as one segment', async () => {
  const bTurboJson = rootReadTurboJson([
    '$TURBO_ROOT$/fixtures/**',
    '$TURBO_ROOT$/journeys/**/*.e2e.ts',
    '$TURBO_ROOT$/group/*/package.json',
  ])
  const cases: ReadonlyArray<readonly [string, boolean]> = [
    ['fixtures/top.txt', true],
    ['fixtures/deep/nested.txt', true],
    ['journeys/top.e2e.ts', true],
    ['journeys/deep/nested.e2e.ts', true],
    ['journeys/top.ts', false],
    ['group/one/package.json', true],
    ['group/one/deep/package.json', false],
    ['outside.txt', false],
  ]
  for (const [file, read] of cases) {
    await withRepo({ bTurboJson }, async (dir) => {
      const moved = await tasksMovedBy(dir, () => write(dir, file, 'probe\n'))
      assertEqual(moved, read ? ['@probe/b#test'] : [], `${file} ${read ? 'is' : 'is not'} read`)
    })
  }
})

const rootEntryTurboJson = (entry: string): string =>
  `{
  "$schema": "${SCHEMA}",
  "futureFlags": { "affectedUsingTaskInputs": true, "githubActionsRemoteBaseRefFallback": true },
  "tasks": {
    "//#root": {},
    "build": { "inputs": ["src/**"], "outputs": [] },
    "test": { "inputs": ["src/**"], "outputs": [], "dependsOn": ["build"], "env": ["NODE_ENV"] },
    "@probe/b#test": ${entry}
  }
}
`

Deno.test('a complete root package-task entry resolves $TURBO_DEFAULT$ in its package, and its $TURBO_ROOT$ read moves only that reader', async () => {
  const complete = rootEntryTurboJson(
    '{ "inputs": ["$TURBO_DEFAULT$", "!**/README.md", "$TURBO_ROOT$/shared.txt"], "outputs": [], "dependsOn": ["build"], "env": ["NODE_ENV"] }',
  )
  await withRepo({ rootTurboJson: complete }, async (dir) => {
    const entry = await resolvedDefinitionOf(dir, '@probe/b#test')
    assertEqual([entry.dependsOn, entry.env], [['build'], ['NODE_ENV']], 'a complete entry keeps what it declares')
    const bySource = await tasksMovedBy(dir, () => write(dir, 'packages/b/src/index.js', 'export const b = 2\n'))
    assert(
      bySource.includes('@probe/b#test'),
      `$TURBO_DEFAULT$ covers the package's source, got ${JSON.stringify(bySource)}`,
    )
    assert(
      !bySource.includes('@probe/a#test'),
      `$TURBO_DEFAULT$ stays inside the package, got ${JSON.stringify(bySource)}`,
    )
    const byReadme = await tasksMovedBy(dir, () => write(dir, 'packages/b/README.md', 'readme\n'))
    assertEqual(byReadme, [], "the entry's README negation applies")
    await git(dir, ['checkout', '-q', '--', '.'])
    await git(dir, ['clean', '-q', '-fd'])
    const moved = await tasksMovedBy(dir, () => write(dir, 'shared.txt', 'shared\nmore\n'))
    assertEqual(moved, ['@probe/b#test'], 'only the reader of the root file changes hash')
  })
})
