#!/usr/bin/env -S deno run --config=scripts/deno.json --allow-read --allow-write --allow-run=git,pnpm --allow-import --allow-net=jsr.io,registry.npmjs.org

import { parseArgs } from '@std/cli/parse-args'
import { loadWorkspaceCycle } from './lib/cycle.ts'
import { countPendingIntents } from './lib/pending-intents.ts'

const flags = parseArgs(Deno.args, {
  string: ['output', 'deferred'],
})

const readDeferred = async (file?: string): Promise<string[]> => {
  if (!file) return []
  try {
    const text = await Deno.readTextFile(file)
    return text.split('\n').map((line) => line.trim()).filter(Boolean)
  } catch {
    return []
  }
}

const deferred = await readDeferred(flags.deferred)
const pending = await countPendingIntents('.changeset')

const allOwed = await loadWorkspaceCycle()
const owed = allOwed.filter((entry) => !deferred.includes(entry.name)).length
const phase = owed > 0 ? 'publish' : pending > 0 ? 'version' : 'none'

for (const name of deferred) {
  console.log(
    `::warning title=Unpublished package::${name} has never been published, and OIDC cannot debut a package. Run \`pnpm publish:unpublished\`, then register the trusted publisher.`,
  )
}

const outputs = [
  `phase=${phase}`,
  `pending_intents=${pending}`,
  `this_cycle=${owed}`,
  `deferred=${deferred.length}`,
].join('\n')

console.error(
  `plan-release: pending_intents=${pending} this_cycle=${owed} deferred=${deferred.length} -> phase=${phase}`,
)

if (flags.output) await Deno.writeTextFile(flags.output, `${outputs}\n`, { append: true })
else console.log(outputs)
