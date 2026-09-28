#!/usr/bin/env -S deno run --config=scripts/deno.json --allow-read --allow-run=git --allow-import --allow-net=jsr.io

import { withoutAll } from '@std/collections/without-all'
import { expandGlob } from '@std/fs/expand-glob'
import { collectChangesetIntents } from './lib/changeset-intents.ts'
import { run } from './lib/run.ts'

const publicPackages = async () => {
  const names: string[] = []
  for await (const file of expandGlob('{apps,packages}/*/package.json')) {
    const pkg = JSON.parse(await Deno.readTextFile(file.path)) as {
      name?: string
      version?: string
      private?: boolean
    }
    if (pkg.name && pkg.version && !pkg.private) names.push(pkg.name)
  }
  return names
}

const namedIntents = async () => (await collectChangesetIntents('.changeset')).map((intent) => intent.package)

const baseSha = Deno.args[0]
if (!baseSha) {
  console.error('usage: ./scripts/check-changeset.ts <base-sha>')
  Deno.exit(2)
}

const changed = (await run('git', ['diff', '--name-only', `${baseSha}...HEAD`])).split('\n').filter(Boolean)
const WORKSPACE_ROOTS = ['apps', 'packages'] as const
const touched = changed.some((file) => WORKSPACE_ROOTS.some((root) => file === root || file.startsWith(`${root}/`)))
  ? await publicPackages()
  : []
const missing = withoutAll(touched, await namedIntents())

if (missing.length === 0) {
  console.log(
    touched.length === 0 ? 'no publishable-package paths in the diff' : `changeset covers: ${touched.join(', ')}`,
  )
  Deno.exit(0)
}

console.error(
  `::error::publishable package(s) changed with no changeset intent: ${
    missing.join(', ')
  }. Author one with \`pnpm change --bump <none|patch|minor|major> --summary "<changelog entry>" ${missing[0]}\`.`,
)
Deno.exit(1)
