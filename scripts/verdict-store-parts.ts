#!/usr/bin/env -S deno run --allow-read --allow-write --allow-env=GITHUB_OUTPUT,GITHUB_STEP_SUMMARY
import { createHash } from 'node:crypto'
import type { Dirent } from 'node:fs'
import { appendFile, copyFile, mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import process from 'node:process'
import { parseArgs } from 'node:util'

export const STORE_DIRECTORY = 'reports/stryker-verdicts'
export const PART_PREFIX = 'verdict-part-'
export const STAGED_MARKER = 'staged.json'
export const CACHE_PREFIX = 'mutation-verdicts-'
const ENTRY_FILE_NAME = /^(tested|checker)-[0-9a-f]{64}\.json$/u

export interface PlannedProject {
  readonly project: string
  readonly mutants: ReadonlyArray<string>
}

export interface PlannedShard {
  readonly index: number
  readonly count: number
  readonly projects: ReadonlyArray<PlannedProject>
}

export interface Plan {
  readonly shards: ReadonlyArray<PlannedShard>
}

export type RefusalCode =
  | 'PLAN_UNREADABLE'
  | 'PLAN_SHARD_ABSENT'
  | 'SHARD_STORE_UNREADABLE'
  | 'VERDICT_PART_UNWRITABLE'
  | 'VERDICT_PART_UNREADABLE'
  | 'VERDICT_PART_UNPLANNED'
  | 'VERDICT_PART_OUTSIDE_STORE'
  | 'VERDICT_STORE_UNWRITABLE'
  | 'MERGED_STORE_UNREADABLE'
  | 'USAGE'

export interface Refusal {
  readonly code: RefusalCode
  readonly message: string
  readonly next: string
}

export type Outcome<A> = { readonly ok: true; readonly value: A } | { readonly ok: false; readonly refusal: Refusal }

const succeed = <A>(value: A): Outcome<A> => ({ ok: true, value })
const refuse = <A>(refusal: Refusal): Outcome<A> => ({ ok: false, refusal })

export const shardNameOf = (shard: PlannedShard): string => `${shard.index}/${shard.count}`
export const slugOf = (shard: string): string => shard.replace('/', 'of')

export const isEntryPath = (storeRelative: string): boolean => {
  const segments = storeRelative.split('/')
  return segments.length === 3 && segments.every((segment) => segment !== '' && !segment.startsWith('.')) &&
    ENTRY_FILE_NAME.test(segments[2] ?? '')
}

const mutantOf = (storeRelative: string): string | undefined => {
  const segments = storeRelative.split('/')
  return segments.length === 3 ? segments[1] : undefined
}

export const plannedShardOf = (plan: Plan, shard: string): Outcome<PlannedShard> => {
  const found = plan.shards.find((planned) => shardNameOf(planned) === shard)
  return found === undefined
    ? refuse({
      code: 'PLAN_SHARD_ABSENT',
      message: `shard ${shard} is not one of the ${plan.shards.length} shards in the plan`,
      next: 're-run the plan job; this shard name is not in plan.json',
    })
    : succeed(found)
}

export interface Staged {
  readonly entries: ReadonlyArray<string>
  readonly skipped: ReadonlyArray<string>
}

export const stagedOf = (mutants: ReadonlyArray<string>, listing: ReadonlyArray<string>): Staged => {
  const planned = new Set(mutants)
  const own = listing.filter((file) => planned.has(mutantOf(file) ?? ''))
  return { entries: own.filter(isEntryPath).sort(), skipped: own.filter((file) => !isEntryPath(file)).sort() }
}

export interface PartListing {
  readonly files: ReadonlyArray<string>
  readonly markedShard: string | undefined
}

export interface Merge {
  readonly winners: ReadonlyArray<readonly [entryPath: string, winningSlug: string]>
  readonly collisions: ReadonlyArray<string>
  readonly merged: ReadonlyArray<string>
  readonly missing: ReadonlyArray<string>
}

const storeRootOf = (project: string): string => `${project}/${STORE_DIRECTORY}/`

const projectEntryOf = (projects: ReadonlyArray<string>, file: string): boolean =>
  projects.some((project) =>
    file.startsWith(storeRootOf(project)) && isEntryPath(file.slice(storeRootOf(project).length))
  )

export const mergeOf = (
  plan: Plan,
  projects: ReadonlyArray<string>,
  parts: ReadonlyMap<string, PartListing>,
): Outcome<Merge> => {
  const order = plan.shards.map((shard) => slugOf(shardNameOf(shard)))
  const unplanned = [...parts.keys()].filter((slug) => !order.includes(slug)).sort()
  const mismarked = order.filter((slug) => {
    const part = parts.get(slug)
    return part !== undefined && part.markedShard !== undefined && slugOf(part.markedShard) !== slug
  })
  const outside = order.flatMap((slug) =>
    (parts.get(slug)?.files ?? []).filter((file) => !projectEntryOf(projects, file)).map((file) => `${slug}: ${file}`)
  )
  if (unplanned.length > 0 || mismarked.length > 0) {
    return refuse({
      code: 'VERDICT_PART_UNPLANNED',
      message: `parts the plan does not name: ${[...unplanned, ...mismarked].join(', ')}`,
      next: 'compare the verdict-part artifacts of this run with plan.json; re-run the whole workflow if they disagree',
    })
  }
  if (outside.length > 0) {
    return refuse({
      code: 'VERDICT_PART_OUTSIDE_STORE',
      message: `${outside.length} part file(s) are not entries of a mutated project's store, first ${outside[0]}`,
      next: "inspect that shard's stage summary; a part may carry only <project>/reports/stryker-verdicts entries",
    })
  }
  const carriers = new Map<string, string[]>()
  for (const slug of order) {
    for (const file of parts.get(slug)?.files ?? []) carriers.set(file, [...(carriers.get(file) ?? []), slug])
  }
  const winners = [...carriers.entries()]
    .map(([file, slugs]) => [file, slugs[slugs.length - 1] ?? ''] as const)
    .sort(([a], [b]) => a.localeCompare(b))
  return succeed({
    winners,
    collisions: [...carriers.entries()].filter(([, slugs]) => slugs.length > 1).map(([file]) => file).sort(),
    merged: order.filter((slug) => parts.has(slug)),
    missing: order.filter((slug) => !parts.has(slug)),
  })
}

export interface StoreFileDigest {
  readonly path: string
  readonly sha256: string
}

const sha256Of = (bytes: string | Uint8Array): string => createHash('sha256').update(bytes).digest('hex')

export const storeKeyOf = (digests: ReadonlyArray<StoreFileDigest>): string =>
  digests.length === 0 ? '' : `${CACHE_PREFIX}${
    sha256Of(
      [...digests]
        .sort((a, b) => a.path.localeCompare(b.path))
        .map((digest) => `${digest.path.length}:${digest.path}${digest.sha256}`)
        .join(''),
    )
  }`

export interface StagedProject {
  readonly project: string
  readonly storeFound: boolean
  readonly part: Staged
}

export const stageSummaryOf = (shard: string, staged: ReadonlyArray<StagedProject>): string => {
  const absent = staged.filter(({ storeFound }) => !storeFound).map(({ project }) => project)
  const note = staged.every(({ part }) => part.entries.length === 0)
    ? absent.length === staged.length
      ? `No project has a \`${STORE_DIRECTORY}\` directory: a CLI that predates the store writes none, and a store written anywhere else is not staged.`
      : "No store entry belongs to this shard's mutants."
    : undefined
  return [
    `### Verdict store part of shard ${shard}`,
    '',
    `- store directories found: ${staged.length - absent.length} of ${staged.length} planned projects${
      absent.length > 0 ? ` (absent: ${absent.join(', ')})` : ''
    }`,
    ...staged.map(({ project, part }) =>
      `- \`${project}\`: ${part.entries.length} entr${part.entries.length === 1 ? 'y' : 'ies'} staged${
        part.skipped.length > 0 ? `, ${part.skipped.length} non-entry file(s) left behind` : ''
      }`
    ),
    ...(note === undefined ? [] : ['', note]),
    '',
  ].join('\n')
}

export const mergeSummaryOf = (
  merge: Merge,
  planned: number,
  totals: { readonly entries: number; readonly bytes: number; readonly key: string },
): string =>
  [
    '### Verdict store merge',
    '',
    `- parts merged: ${merge.merged.length} of ${planned} shards planned${
      merge.missing.length > 0 ? ` (missing: ${merge.missing.join(', ')})` : ''
    }`,
    `- entries laid over the restored store: ${merge.winners.length}`,
    `- collisions (names more than one part carried): ${merge.collisions.length}`,
    `- combined store: ${totals.entries} entries, ${totals.bytes} bytes`,
    `- cache key: ${totals.key === '' ? 'none (no entries, nothing to save)' : `\`${totals.key}\``}`,
    '',
  ].join('\n')

const escapeCommandData = (text: string): string =>
  text.replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A')

export const annotationOf = (refusal: Refusal): string =>
  `::error title=${refusal.code}::${escapeCommandData(`${refusal.message}. Next: ${refusal.next}`)}`

const isMissing = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'

const listDirectory = (path: string): Promise<ReadonlyArray<Dirent>> =>
  readdir(path, { withFileTypes: true }).catch((error: unknown) => {
    if (isMissing(error)) return []
    throw error
  })

const walk = async (root: string, prefix = ''): Promise<ReadonlyArray<string>> => {
  const listed = await listDirectory(join(root, prefix))
  const nested = await Promise.all(
    listed.map((entry) => {
      const relative = prefix === '' ? entry.name : `${prefix}/${entry.name}`
      return entry.isDirectory() ? walk(root, relative) : Promise.resolve(entry.isFile() ? [relative] : [])
    }),
  )
  return nested.flat()
}

const isDirectory = (path: string): Promise<boolean> =>
  stat(path).then((found) => found.isDirectory(), (error: unknown) => {
    if (isMissing(error)) return false
    throw error
  })

const copyInto = async (from: string, to: string): Promise<void> => {
  await mkdir(dirname(to), { recursive: true })
  await copyFile(from, to)
}

const report = async (summary: string, outputs: Readonly<Record<string, string>>): Promise<void> => {
  process.stdout.write(summary)
  const stepSummary = process.env['GITHUB_STEP_SUMMARY']
  if (stepSummary) await appendFile(stepSummary, summary)
  const output = process.env['GITHUB_OUTPUT']
  if (output) {
    await appendFile(output, Object.entries(outputs).map(([name, value]) => `${name}=${value}\n`).join(''))
  }
}

const failWith = (refusal: Refusal): never => {
  process.stdout.write(`${annotationOf(refusal)}\n`)
  process.exit(1)
}

const unwrap = <A>(outcome: Outcome<A>): A => outcome.ok ? outcome.value : failWith(outcome.refusal)

const guarded = <A>(code: RefusalCode, next: string, run: () => Promise<A>): Promise<A> =>
  run().catch((error: unknown) =>
    failWith({ code, message: error instanceof Error ? error.message : String(error), next })
  )

const projectsOf = (csv: string): ReadonlyArray<string> => csv.split(',').filter((project) => project !== '')

const isPlannedProject = (value: unknown): value is PlannedProject =>
  typeof value === 'object' && value !== null && 'project' in value && typeof value.project === 'string' &&
  'mutants' in value && Array.isArray(value.mutants) && value.mutants.every((id) => typeof id === 'string')

const isPlannedShard = (value: unknown): value is PlannedShard =>
  typeof value === 'object' && value !== null && 'index' in value && Number.isInteger(value.index) &&
  'count' in value && Number.isInteger(value.count) && 'projects' in value && Array.isArray(value.projects) &&
  value.projects.every(isPlannedProject)

const isPlan = (value: unknown): value is Plan =>
  typeof value === 'object' && value !== null && 'shards' in value && Array.isArray(value.shards) &&
  value.shards.every(isPlannedShard)

const readPlan = (file: string): Promise<Plan> =>
  guarded('PLAN_UNREADABLE', 're-run the plan job; plan.json is missing or not a shard plan', async () => {
    const parsed: unknown = JSON.parse(await readFile(file, 'utf8'))
    if (!isPlan(parsed)) throw new Error(`${file} has no shards[].{index, count, projects[].{project, mutants}}`)
    return parsed
  })

const markedShardOf = (text: string): string | undefined => {
  const parsed: unknown = JSON.parse(text)
  return typeof parsed === 'object' && parsed !== null && 'shard' in parsed && typeof parsed.shard === 'string'
    ? parsed.shard
    : undefined
}

const stage = async (args: Readonly<Record<string, string | undefined>>): Promise<void> => {
  const shard = args['shard'] ?? ''
  const out = args['out'] ?? 'verdict-part'
  const planned = unwrap(plannedShardOf(await readPlan(args['plan'] ?? 'plan.json'), shard))
  const projects = projectsOf(args['projects'] ?? '')
  const staged = await guarded('SHARD_STORE_UNREADABLE', 're-run failed jobs', () =>
    Promise.all(
      planned.projects
        .filter((entry) => projects.includes(entry.project))
        .map(async (entry): Promise<StagedProject> => {
          const root = join(entry.project, STORE_DIRECTORY)
          return {
            project: entry.project,
            storeFound: await isDirectory(root),
            part: stagedOf(entry.mutants, await walk(root)),
          }
        }),
    ))
  await guarded('VERDICT_PART_UNWRITABLE', 're-run failed jobs; the runner could not write the part', async () => {
    for (const { project, part } of staged) {
      for (const file of part.entries) {
        const relative = `${project}/${STORE_DIRECTORY}/${file}`
        await copyInto(relative, join(out, relative))
      }
    }
    await mkdir(out, { recursive: true })
    await writeFile(join(out, STAGED_MARKER), JSON.stringify({ shard }))
  })
  const entries = staged.reduce((sum, { part }) => sum + part.entries.length, 0)
  await report(stageSummaryOf(shard, staged), { entries: String(entries) })
}

const merge = async (args: Readonly<Record<string, string | undefined>>): Promise<void> => {
  const plan = await readPlan(args['plan'] ?? 'plan.json')
  const projects = projectsOf(args['projects'] ?? '')
  const partsRoot = args['parts'] ?? 'verdict-parts'
  const parts = await guarded('VERDICT_PART_UNREADABLE', 're-run failed jobs', async () => {
    const directories = await listDirectory(partsRoot)
    const listed = await Promise.all(
      directories.filter((entry) => entry.isDirectory() && entry.name.startsWith(PART_PREFIX)).map(async (entry) => {
        const root = join(partsRoot, entry.name)
        const marker = await readFile(join(root, STAGED_MARKER), 'utf8').then(markedShardOf, () => undefined)
        const files = (await walk(root)).filter((file) => file !== STAGED_MARKER)
        return [entry.name.slice(PART_PREFIX.length), { files, markedShard: marker }] as const
      }),
    )
    return new Map<string, PartListing>(listed)
  })
  const decided = unwrap(mergeOf(plan, projects, parts))
  await guarded('VERDICT_STORE_UNWRITABLE', 're-run failed jobs; the runner could not write the store', async () => {
    for (const [file, slug] of decided.winners) await copyInto(join(partsRoot, `${PART_PREFIX}${slug}`, file), file)
  })
  const digests = await guarded(
    'MERGED_STORE_UNREADABLE',
    're-run failed jobs',
    async () =>
      (await Promise.all(projects.map(async (project) => {
        const root = join(project, STORE_DIRECTORY)
        const files = (await walk(root)).filter(isEntryPath)
        return Promise.all(files.map(async (file) => {
          const bytes = await readFile(join(root, file))
          return { path: `${project}/${STORE_DIRECTORY}/${file}`, sha256: sha256Of(bytes), size: bytes.byteLength }
        }))
      }))).flat(),
  )
  const key = storeKeyOf(digests)
  const bytes = digests.reduce((sum, digest) => sum + digest.size, 0)
  if (decided.missing.length > 0) {
    process.stdout.write(
      `::warning title=VERDICT_PARTS_MISSING::no verdict part from shard(s) ${
        decided.missing.join(', ')
      }. Next: nothing; their mutants re-run next time\n`,
    )
  }
  await report(mergeSummaryOf(decided, plan.shards.length, { entries: digests.length, bytes, key }), {
    key,
    entries: String(digests.length),
    bytes: String(bytes),
  })
}

if (import.meta.main) {
  const { positionals, values } = parseArgs({
    args: process.argv.slice(2),
    allowPositionals: true,
    options: {
      plan: { type: 'string' },
      shard: { type: 'string' },
      projects: { type: 'string' },
      out: { type: 'string' },
      parts: { type: 'string' },
    },
  })
  const command = positionals[0]
  if (command === 'stage') await stage(values)
  else if (command === 'merge') await merge(values)
  else {
    failWith({
      code: 'USAGE',
      message: `unknown command ${command ?? '(none)'}`,
      next: 'run `stage` or `merge`',
    })
  }
}
