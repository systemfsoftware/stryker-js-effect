import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import { TurboAffectedPaths } from '../test/bench/src/turbo-affected.schema.ts'
import { turboAffectedArgs } from '../test/bench/src/turbo-affected.ts'
import { assertEqual } from './assert.ts'
import { commit, git, PERMITTED_SCRATCH_DIR, run, TURBO_PROGRAM, write } from './process.ts'

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
    const base = await commit(dir, 'workspace', { allowEmpty: true })
    await change(dir)
    const head = await commit(dir, 'change', { allowEmpty: true })
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
