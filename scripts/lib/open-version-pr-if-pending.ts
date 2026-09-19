import { countPendingIntents } from './pending-intents.ts'
import { shouldOpenVersionPrAfterPublish } from './release-phase.ts'
import { run } from './run.ts'

export const openVersionPrIfPending = async (): Promise<void> => {
  const pending = await countPendingIntents('.changeset')
  if (!shouldOpenVersionPrAfterPublish('publish', pending)) {
    console.log('no pending change intents after publish — skipping version PR')
    return
  }

  const token = Deno.env.get('GH_TOKEN') ?? Deno.env.get('GITHUB_TOKEN')
  if (token === undefined) {
    throw new Error('GH_TOKEN or GITHUB_TOKEN required to open the version PR after publish')
  }

  const branch = Deno.env.get('BRANCH') ?? 'changeset-release/main'
  const base = Deno.env.get('BASE') ?? 'main'
  console.log(`consume ${pending} pending intent(s) and open ${branch}`)

  const bumped = await new Deno.Command('pnpm', {
    args: ['version', '-r'],
    stdout: 'inherit',
    stderr: 'inherit',
  }).output()
  if (!bumped.success) {
    throw new Error(`pnpm version -r failed (exit ${bumped.code})`)
  }

  await run('./scripts/tag-released-packages.ts', [
    '--dry-run',
    '--json',
    '--output',
    '/tmp/captured-next.json',
  ])
  await run('./scripts/create-github-releases.ts', ['--assert', '--captured', '/tmp/captured-next.json'])

  const opened = await new Deno.Command('bash', {
    args: ['./scripts/open-release-pr.sh'],
    env: {
      ...Deno.env.toObject(),
      GH_TOKEN: token,
      BRANCH: branch,
      BASE: base,
    },
    stdout: 'inherit',
    stderr: 'inherit',
  }).output()
  if (!opened.success) {
    throw new Error(`open-release-pr.sh failed (exit ${opened.code})`)
  }
}
