import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import { TurboAffectedPaths } from '../test/bench/src/turbo-affected.schema.ts'
import { turboAffectedArgs } from '../test/bench/src/turbo-affected.ts'
import { assertEqual } from './assert.ts'

const TURBO_PROGRAM = new URL('../node_modules/.bin/turbo', import.meta.url).pathname

const PERMITTED_SCRATCH_DIR = '/tmp'

const decode = (bytes: Uint8Array): string => new TextDecoder().decode(bytes)

const cleanEnv = (): Record<string, string> => {
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
  return env
}

interface Ran {
  readonly code: number
  readonly stdout: string
  readonly stderr: string
}

const run = async (program: string, args: ReadonlyArray<string>, cwd: string): Promise<Ran> => {
  const output = await new Deno.Command(program, { args: [...args], cwd, env: cleanEnv(), clearEnv: true }).output()
  return { code: output.code, stdout: decode(output.stdout), stderr: decode(output.stderr) }
}

const git = async (dir: string, args: ReadonlyArray<string>): Promise<string> => {
  const ran = await run('git', args, dir)
  if (ran.code !== 0) throw new Error(`git ${args.join(' ')} failed: ${ran.stderr}`)
  return ran.stdout
}

const commit = async (dir: string, message: string): Promise<string> => {
  await git(dir, ['add', '-A'])
  await git(dir, ['commit', '-q', '--allow-empty', '-m', message])
  return (await git(dir, ['rev-parse', 'HEAD'])).trim()
}

const write = async (dir: string, relative: string, content: string): Promise<void> => {
  const path = `${dir}/${relative}`
  await Deno.mkdir(path.slice(0, path.lastIndexOf('/')), { recursive: true })
  await Deno.writeTextFile(path, content)
}

const packageJson = (name: string): string => `{ "name": "${name}", "version": "0.0.0" }\n`

const seedWorkspace = async (dir: string): Promise<void> => {
  await write(dir, 'package.json', '{ "name": "probe-root", "private": true, "packageManager": "pnpm@9.15.0" }\n')
  await write(dir, 'pnpm-workspace.yaml', 'packages:\n  - packages/*\n')
  await write(
    dir,
    'pnpm-lock.yaml',
    "lockfileVersion: '9.0'\n\nimporters:\n  .: {}\n  packages/a: {}\n  packages/b: {}\n",
  )
  await write(dir, 'turbo.json', '{ "tasks": { "typecheck": {} } }\n')
  await write(dir, 'packages/a/package.json', packageJson('@probe/a'))
  await write(dir, 'packages/a/src/index.js', 'export const a = 1\n')
  await write(dir, 'packages/b/package.json', packageJson('@probe/b'))
  await write(dir, 'packages/b/src/index.js', 'export const b = 1\n')
  await write(dir, 'README.md', 'probe\n')
}

const affectedPathsAfter = async (change: (dir: string) => Promise<void>): Promise<ReadonlyArray<string>> => {
  const dir = await Deno.makeTempDir({ dir: PERMITTED_SCRATCH_DIR, prefix: 'turbo-affected-packages-' })
  try {
    await git(dir, ['init', '-q', '-b', 'trunk', '.'])
    await seedWorkspace(dir)
    const base = await commit(dir, 'workspace')
    await change(dir)
    const head = await commit(dir, 'change')
    const args = turboAffectedArgs({ base, head })
    const ran = await run(TURBO_PROGRAM, args, dir)
    if (ran.code !== 0) throw new Error(`turbo ${args.join(' ')} failed: ${ran.stderr}`)
    const decoded = S.decodeUnknownResult(TurboAffectedPaths)(ran.stdout)
    if (Result.isFailure(decoded)) {
      throw new Error(`TurboAffectedPaths refused turbo's output: ${decoded.failure.message}\n${ran.stdout}`)
    }
    return decoded.success
  } finally {
    await Deno.remove(dir, { recursive: true })
  }
}

Deno.test("a changed package is reported as its repo-relative directory, with no './' and no trailing '/'", async () => {
  const paths = await affectedPathsAfter((dir) => write(dir, 'packages/a/src/index.js', 'export const a = 2\n'))
  assertEqual(paths, ['packages/a'], 'one changed package')
})

Deno.test('a change to a root file outside every package is reported as the empty path', async () => {
  const paths = await affectedPathsAfter((dir) => write(dir, 'README.md', 'probe, edited\n'))
  assertEqual(paths, [''], 'a root file change')
})

Deno.test('a commit that changes no file reports no package', async () => {
  const paths = await affectedPathsAfter(() => Promise.resolve())
  assertEqual(paths, [], 'no change')
})
