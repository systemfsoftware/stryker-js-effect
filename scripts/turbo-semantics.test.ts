const REPO_ROOT = new URL('../', import.meta.url)

const TURBO_PROGRAM = 'node_modules/.bin/turbo'

const TASKS = ['build', 'test']

const UNKNOWN_SHA = '0'.repeat(40)

const SCHEMA = 'https://v2-10-1.turborepo.dev/schema.json'

const PERMITTED_SCRATCH_DIR = '/tmp'

const decode = (bytes: Uint8Array): string => new TextDecoder().decode(bytes)

const assertEqual = (actual: unknown, expected: unknown, label: string): void => {
  const serialize = (value: unknown): string => JSON.stringify(value)
  if (serialize(actual) !== serialize(expected)) {
    throw new Error(`${label}: expected ${serialize(expected)}, got ${serialize(actual)}`)
  }
}

const assert = (condition: boolean, label: string): void => {
  if (!condition) throw new Error(label)
}

const cleanEnv = (overrides: Readonly<Record<string, string>> = {}): Record<string, string> => {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(Deno.env.toObject())) {
    if (key.startsWith('GITHUB_') || key.startsWith('TURBO_')) continue
    env[key] = value
  }
  env.GIT_AUTHOR_NAME = 'probe'
  env.GIT_AUTHOR_EMAIL = 'probe@example.com'
  env.GIT_COMMITTER_NAME = 'probe'
  env.GIT_COMMITTER_EMAIL = 'probe@example.com'
  env.GIT_CONFIG_GLOBAL = '/dev/null'
  env.GIT_CONFIG_SYSTEM = '/dev/null'
  env.GIT_TERMINAL_PROMPT = '0'
  return { ...env, ...overrides }
}

interface Ran {
  readonly code: number
  readonly stdout: string
  readonly stderr: string
}

const run = async (
  program: string,
  args: ReadonlyArray<string>,
  cwd: string | URL,
  env: Readonly<Record<string, string>>,
): Promise<Ran> => {
  const output = await new Deno.Command(program, { args: [...args], cwd, env, clearEnv: true })
    .output()
  return { code: output.code, stdout: decode(output.stdout), stderr: decode(output.stderr) }
}

const git = async (dir: string, args: ReadonlyArray<string>): Promise<Ran> => {
  const ran = await run('git', args, dir, cleanEnv())
  if (ran.code !== 0) throw new Error(`git ${args.join(' ')} failed: ${ran.stderr}`)
  return ran
}

const commit = async (dir: string, message: string): Promise<string> => {
  await git(dir, ['add', '-A'])
  await git(dir, ['commit', '-q', '-m', message])
  return (await git(dir, ['rev-parse', 'HEAD'])).stdout.trim()
}

const head = async (dir: string): Promise<string> => (await git(dir, ['rev-parse', 'HEAD'])).stdout.trim()

const write = async (dir: string, relative: string, content: string): Promise<void> => {
  const path = `${dir}/${relative}`
  await Deno.mkdir(path.slice(0, path.lastIndexOf('/')), { recursive: true })
  await Deno.writeTextFile(path, content)
}

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

const affectedLengthOf = (stdout: string): number => {
  const parsed: unknown = JSON.parse(stdout)
  if (typeof parsed !== 'object' || parsed === null || !('data' in parsed)) {
    throw new Error(`unexpected query output: ${stdout.slice(0, 200)}`)
  }
  const { data } = parsed
  if (typeof data !== 'object' || data === null || !('affectedTasks' in data)) {
    throw new Error(`unexpected query output: ${stdout.slice(0, 200)}`)
  }
  const { affectedTasks } = data
  if (typeof affectedTasks !== 'object' || affectedTasks === null || !('length' in affectedTasks)) {
    throw new Error(`unexpected query output: ${stdout.slice(0, 200)}`)
  }
  const { length } = affectedTasks
  if (typeof length !== 'number') throw new Error(`unexpected query length: ${JSON.stringify(length)}`)
  return length
}

interface Summary {
  readonly taskCount: number
}

const summaryOf = (text: string): Summary => {
  const parsed: unknown = JSON.parse(text)
  if (typeof parsed !== 'object' || parsed === null || !('tasks' in parsed) || !Array.isArray(parsed.tasks)) {
    throw new Error(`unexpected run summary: ${text.slice(0, 200)}`)
  }
  return { taskCount: parsed.tasks.length }
}

const rootPackageJson = `{
  "name": "probe-root",
  "private": true,
  "packageManager": "pnpm@9.15.0",
  "scripts": { "root": "echo root" }
}
`

const editedRootPackageJson = `{
  "name": "probe-root",
  "private": true,
  "packageManager": "pnpm@9.15.0",
  "scripts": { "root": "echo root", "extra": "true" }
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

const shippedRootTurboJson = `{
  "$schema": "${SCHEMA}",
  "futureFlags": { "affectedUsingTaskInputs": true, "githubActionsRemoteBaseRefFallback": true },
  "tasks": {
    "//#root": {},
    "build": { "inputs": ["src/**"], "outputs": [] },
    "test": { "inputs": ["$TURBO_DEFAULT$", "!**/README.md"], "env": ["NODE_ENV"], "outputs": [] }
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
  readonly rootPackageJson?: string
  readonly branch?: string
}

const seedFixture = async (dir: string, options: FixtureOptions): Promise<void> => {
  await write(dir, 'package.json', options.rootPackageJson ?? rootPackageJson)
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
    await git(dir, ['init', '-q', '-b', options.branch ?? 'trunk', '.'])
    await seedFixture(dir, options)
    await commit(dir, 'fixture')
    return await body(dir)
  } finally {
    await Deno.remove(dir, { recursive: true })
  }
}

interface DryRunOptions {
  readonly affected?: boolean
  readonly base?: string
  readonly env?: Readonly<Record<string, string>>
}

const turboRun = (dir: string, options: DryRunOptions): Promise<Ran> => {
  const args = ['run', ...TASKS, '--dry=json', '--cwd', dir]
  if (options.affected === true) args.push('--affected')
  const overrides: Record<string, string> = options.base === undefined ? {} : { TURBO_SCM_BASE: options.base }
  return run(TURBO_PROGRAM, args, REPO_ROOT, cleanEnv({ ...overrides, ...options.env }))
}

const dryRun = async (dir: string, options: DryRunOptions = {}): Promise<ReadonlyArray<TaskEntry>> => {
  const ran = await turboRun(dir, options)
  if (ran.code !== 0) throw new Error(`turbo run failed: ${ran.stderr}`)
  return tasksOf(ran.stdout)
}

const selectedTasks = async (dir: string, options: DryRunOptions = {}): Promise<Array<string>> => {
  const tasks = await dryRun(dir, { ...options, affected: true })
  return tasks.map((task) => task.taskId).sort()
}

const allTasks = async (dir: string): Promise<Array<string>> =>
  (await dryRun(dir, { affected: false })).map((task) => task.taskId).sort()

const hashOf = async (dir: string, taskId: string): Promise<string> => {
  const tasks = await dryRun(dir, { affected: false })
  const task = tasks.find((candidate) => candidate.taskId === taskId)
  if (task === undefined) throw new Error(`task ${taskId} missing from dry run`)
  return task.hash
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
  const ran = await turboRun(dir, { affected: false })
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

const queryAffectedTaskCount = async (dir: string, base: string, headRef: string): Promise<number> => {
  const query = `query { affectedTasks(base: "${base}", head: "${headRef}", tasks: ${
    JSON.stringify(TASKS)
  }) { length } }`
  const ran = await run(TURBO_PROGRAM, ['query', '--cwd', dir, query], REPO_ROOT, cleanEnv())
  if (ran.code !== 0) throw new Error(`turbo query failed: ${ran.stderr}`)
  return affectedLengthOf(ran.stdout)
}

const runSummaryTaskCounts = async (dir: string): Promise<Array<number>> => {
  const runs = `${dir}/.turbo/runs`
  const files: Array<string> = []
  for await (const entry of Deno.readDir(runs)) {
    if (entry.isFile && entry.name.endsWith('.json')) files.push(`${runs}/${entry.name}`)
  }
  return await Promise.all(files.map(async (file) => summaryOf(await Deno.readTextFile(file)).taskCount))
}

Deno.test('a lockfile byte change selects every task under affectedUsingTaskInputs', async () => {
  await withRepo({}, async (dir) => {
    const base = await head(dir)
    await write(dir, 'pnpm-lock.yaml', `${lockfile}# probe\n`)
    await commit(dir, 'lockfile comment')
    assertEqual(await selectedTasks(dir, { base }), await allTasks(dir), 'lockfile byte edit selects every task')
  })
})

Deno.test('a root package.json script edit that changes no dependency selects no task', async () => {
  await withRepo({}, async (dir) => {
    const base = await head(dir)
    await write(dir, 'package.json', editedRootPackageJson)
    await commit(dir, 'root script edit')
    assertEqual(await selectedTasks(dir, { base }), [], 'a dependency-neutral root edit selects no task')
  })
})

Deno.test('a turbo.json edit selects every task', async () => {
  await withRepo({}, async (dir) => {
    const base = await head(dir)
    await write(dir, 'turbo.json', `${rootTurboJson().replace('"outputs": []', '"outputs": [], "outputLogs": "full"')}`)
    await commit(dir, 'turbo.json edit')
    assertEqual(await selectedTasks(dir, { base }), await allTasks(dir), 'a turbo.json edit selects every task')
  })
})

Deno.test("a change to a file excluded from every input selects none of a package's tasks", async () => {
  await withRepo({}, async (dir) => {
    const base = await head(dir)
    await write(dir, 'packages/a/docs/note.md', 'excluded\n')
    await commit(dir, 'file outside every input')
    assertEqual(await selectedTasks(dir, { base }), [], 'a file outside every declared input selects nothing')
  })
})

Deno.test("a $TURBO_ROOT$ input selects the reader while $TURBO_EXTENDS$ keeps the parent's inputs and negations", async () => {
  const bTurboJson = `{
  "extends": ["//"],
  "tasks": { "test": { "inputs": ["$TURBO_EXTENDS$", "$TURBO_ROOT$/shared.txt"] } }
}
`
  const fixture = { rootTurboJson: shippedRootTurboJson, bTurboJson }
  await withRepo(fixture, async (dir) => {
    const base = await head(dir)
    const hashBefore = await hashOf(dir, '@probe/b#test')
    await write(dir, 'shared.txt', 'shared\nmore\n')
    const hashAfter = await hashOf(dir, '@probe/b#test')
    assert(hashBefore !== hashAfter, "editing a $TURBO_ROOT$ input changes the reader's hash")
    await commit(dir, 'root input edit')
    assertEqual(await selectedTasks(dir, { base }), ['@probe/b#test'], 'the reader is selected')
  })
  await withRepo(fixture, async (dir) => {
    const base = await head(dir)
    await write(dir, 'packages/b/src/index.js', 'export const b = 2\n')
    await commit(dir, 'child source edit')
    const selected = await selectedTasks(dir, { base })
    assert(selected.includes('@probe/b#test'), "$TURBO_EXTENDS$ keeps the parent's $TURBO_DEFAULT$")
  })
  await withRepo(fixture, async (dir) => {
    const base = await head(dir)
    await write(dir, 'packages/b/README.md', 'readme\n')
    await commit(dir, 'child readme edit')
    assertEqual(await selectedTasks(dir, { base }), [], "the parent's README negation still applies under extension")
  })
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

Deno.test("$TURBO_EXTENDS$ in a root package-task entry keeps none of the generic task's dependsOn, env or inputs", async () => {
  const extending = rootEntryTurboJson('{ "inputs": ["$TURBO_EXTENDS$", "$TURBO_ROOT$/shared.txt"] }')
  await withRepo({ rootTurboJson: extending }, async (dir) => {
    const generic = await resolvedDefinitionOf(dir, '@probe/a#test')
    assertEqual(generic, { dependsOn: ['build'], env: ['NODE_ENV'], inputs: ['src/**'] }, 'the generic task resolves')
    const entry = await resolvedDefinitionOf(dir, '@probe/b#test')
    assertEqual(entry.dependsOn, [], 'the root entry drops the generic dependsOn')
    assertEqual(entry.env, [], 'the root entry drops the generic env')
    assert(
      !entry.inputs.includes('src/**'),
      `the root entry drops the generic inputs, got ${JSON.stringify(entry.inputs)}`,
    )
  })
})

Deno.test('a $TURBO_ROOT$ read in a complete root package-task entry moves only that reader and selects it with its dependencies', async () => {
  const complete = rootEntryTurboJson(
    '{ "inputs": ["src/**", "$TURBO_ROOT$/shared.txt"], "outputs": [], "dependsOn": ["build"], "env": ["NODE_ENV"] }',
  )
  await withRepo({ rootTurboJson: complete }, async (dir) => {
    const base = await head(dir)
    const entry = await resolvedDefinitionOf(dir, '@probe/b#test')
    assertEqual([entry.dependsOn, entry.env], [['build'], ['NODE_ENV']], 'a complete entry keeps what it declares')
    const before = await dryRun(dir, { affected: false })
    await write(dir, 'shared.txt', 'shared\nmore\n')
    const after = await dryRun(dir, { affected: false })
    const moved = after
      .filter((task) => before.find((prior) => prior.taskId === task.taskId)?.hash !== task.hash)
      .map((task) => task.taskId)
    assertEqual(moved, ['@probe/b#test'], 'only the reader of the root file changes hash')
    await commit(dir, 'root input edit')
    assertEqual(
      await selectedTasks(dir, { base }),
      ['@probe/b#build', '@probe/b#test'],
      'the reader is selected with the build it depends on',
    )
  })
})

Deno.test('an empty selection exits 0 and writes a run summary with no tasks', async () => {
  await withRepo({}, async (dir) => {
    const base = await head(dir)
    await write(dir, 'packages/a/docs/note.md', 'excluded\n')
    await commit(dir, 'file outside every input')
    const ran = await run(
      TURBO_PROGRAM,
      ['run', ...TASKS, '--affected', '--cwd', dir, '--output-logs=errors-only'],
      REPO_ROOT,
      cleanEnv({ TURBO_SCM_BASE: base, TURBO_RUN_SUMMARY: 'true' }),
    )
    assertEqual(ran.code, 0, 'an empty selection exits 0')
    const counts = await runSummaryTaskCounts(dir)
    assert(counts.length > 0, 'a run summary is written')
    assertEqual(counts, counts.map(() => 0), 'an empty selection summarizes to no tasks')
  })
})

Deno.test('GitHub pull_request inference resolves origin/main on a treeless clone and matches the first parent', async () => {
  const remote = await Deno.makeTempDir({ dir: PERMITTED_SCRATCH_DIR, prefix: 'turbo-semantics-remote-' })
  const builder = await Deno.makeTempDir({ dir: PERMITTED_SCRATCH_DIR, prefix: 'turbo-semantics-builder-' })
  const checkout = await Deno.makeTempDir({ dir: PERMITTED_SCRATCH_DIR, prefix: 'turbo-semantics-checkout-' })
  try {
    await git(remote, ['init', '-q', '--bare', '.'])
    await git(remote, ['config', 'uploadpack.allowFilter', 'true'])
    await git(remote, ['config', 'uploadpack.allowAnySHA1InWant', 'true'])

    await git(builder, ['init', '-q', '-b', 'trunk', '.'])
    await seedFixture(builder, {})
    const trunk = await commit(builder, 'fixture')
    await write(builder, 'packages/b/src/index.js', 'export const b = 2\n')
    await commit(builder, 'main advance')
    const firstParent = await head(builder)
    await git(builder, ['checkout', '-q', '-b', 'remote-main', firstParent])
    await write(builder, 'packages/b/src/index.js', 'export const b = 2\nexport const b3 = 3\n')
    await commit(builder, 'main later')
    const remoteMain = await head(builder)
    await git(builder, ['checkout', '-q', '-b', 'feature', trunk])
    await write(builder, 'packages/a/src/index.js', 'export const a = 2\n')
    await commit(builder, 'pull request change')
    await git(builder, ['checkout', '-q', 'trunk'])
    await git(builder, ['merge', '-q', '--no-ff', '-m', 'merge', 'feature'])
    const merge = await head(builder)
    const remoteUrl = `file://${remote}`
    await git(builder, ['push', '-q', remoteUrl, `${remoteMain}:refs/heads/main`, `${merge}:refs/heads/pr1`])

    await git(checkout, ['clone', '-q', '--no-local', '--filter=tree:0', remoteUrl, '.'])
    await git(checkout, ['checkout', '-q', '--detach', merge])
    const missing = (await git(checkout, ['rev-list', '--objects', '--missing=print', '--all']))
      .stdout.split('\n')
      .filter((line) => line.startsWith('?')).length
    assert(missing > 0, 'the treeless filter must still apply to the clone')

    const inferred = await selectedTasks(checkout, { env: { GITHUB_ACTIONS: 'true', GITHUB_BASE_REF: 'main' } })
    const explicit = await selectedTasks(checkout, { base: firstParent })
    assertEqual(inferred, explicit, "GitHub inference matches the merge's first parent")
    assertEqual(inferred, ['@probe/a#build', '@probe/a#test'], 'the pull request change selects exactly its own tasks')
    assert(!inferred.includes('@probe/b#build'), "main's later change is not attributed to the pull request")
  } finally {
    await Promise.all([remote, builder, checkout].map((dir) => Deno.remove(dir, { recursive: true })))
  }
})

Deno.test('a push event payload before base selects what the explicit base selects', async () => {
  await withRepo({}, async (dir) => {
    const base = await head(dir)
    await write(dir, 'packages/a/src/index.js', 'export const a = 2\n')
    await commit(dir, 'push change')
    const eventPath = `${dir}/.push-event.json`
    await Deno.writeTextFile(eventPath, JSON.stringify({ before: base, forced: false, commits: [] }))
    const inferred = await selectedTasks(dir, { env: { GITHUB_ACTIONS: 'true', GITHUB_EVENT_PATH: eventPath } })
    const explicit = await selectedTasks(dir, { base })
    assertEqual(inferred, explicit, 'the push payload before is the base')
    assert(inferred.length > 0, 'the scenario selects at least one task')
  })
})

interface AllZeroPush {
  readonly selected: readonly string[]
  readonly all: readonly string[]
  readonly warned: boolean
}

const allZeroPush = (branch: string): Promise<AllZeroPush> =>
  withRepo({ branch }, async (dir) => {
    await write(dir, 'packages/a/src/index.js', 'export const a = 2\n')
    await commit(dir, 'push change')
    const eventPath = `${dir}/.push-event.json`
    await Deno.writeTextFile(eventPath, JSON.stringify({ before: UNKNOWN_SHA, forced: false, commits: [] }))
    const ran = await turboRun(dir, { affected: true, env: { GITHUB_ACTIONS: 'true', GITHUB_EVENT_PATH: eventPath } })
    assertEqual(ran.code, 0, `the all-zero push on ${branch} still exits 0`)
    return {
      selected: tasksOf(ran.stdout).map((task) => task.taskId).sort(),
      all: await allTasks(dir),
      warned: ran.stderr.includes('could not determine changed files'),
    }
  })

Deno.test('an all-zero push before off main falls back to every task and says it could not determine the change', async () => {
  const push = await allZeroPush('trunk')
  assertEqual(push.selected, push.all, 'an undeterminable push off main runs every task')
  assert(push.warned, 'stderr names the fallback')
})

Deno.test('an all-zero push before on main selects no task and prints no warning', async () => {
  const push = await allZeroPush('main')
  assertEqual(push.selected, [], 'an undeterminable push on main selects nothing')
  assert(!push.warned, 'nothing on stderr says the change was undeterminable')
})

Deno.test('turbo query affectedTasks keeps the package-level lockfile diff and diverges from run --affected', async () => {
  await withRepo({}, async (dir) => {
    const base = await head(dir)
    await write(dir, 'pnpm-lock.yaml', `${lockfile}# probe\n`)
    const next = await commit(dir, 'lockfile comment')
    const viaRun = await selectedTasks(dir, { base })
    assertEqual(viaRun, await allTasks(dir), 'run --affected selects every task on a lockfile byte edit')
    const viaQuery = await queryAffectedTaskCount(dir, base, next)
    assert(viaQuery < viaRun.length, `turbo query does not select every task (got ${viaQuery})`)
  })
})
