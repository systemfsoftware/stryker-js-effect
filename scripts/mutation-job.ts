#!/usr/bin/env -S deno run --allow-read --allow-write --allow-env --allow-run=timeout

import { parseArgs } from '@std/cli/parse-args'
import { expandGlob } from '@std/fs/expand-glob'
import { dirname, join } from '@std/path'

import {
  buildRequireError,
  buildSummary,
  combineParts,
  type Entry,
  type Job,
  loadState,
  type Outcome,
  type Part,
  type PartMeta,
  type Report,
  type Shard,
  slugOf,
  type StagedPart,
} from './lib/mutation-plan.ts'

const incrementalFileOf = (shard: Shard | undefined): string =>
  shard === undefined
    ? 'reports/stryker-incremental.json'
    : `reports/stryker-incremental-${shard.index}of${shard.count}.json`

const labelOf = (dir: string, shard: Shard | undefined): string =>
  shard === undefined ? dir : `${dir} (${shard.index}/${shard.count})`

const shardOfJob = (job: Job): Shard | undefined =>
  job.shard === undefined ? undefined : { index: job.shard.index, count: job.shard.count }

const readText = (path: string): Promise<string> => Deno.readTextFile(path)

const readIfPresent = async (path: string): Promise<string | undefined> => {
  try {
    return await Deno.readTextFile(path)
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return undefined
    throw error
  }
}

const copyIfPresent = async (from: string, to: string): Promise<void> => {
  const text = await readIfPresent(from)
  if (text === undefined) return
  await Deno.mkdir(dirname(to), { recursive: true })
  await Deno.writeTextFile(to, text)
}

const removeOutputsOfEarlierRun = async (reportsDir: string): Promise<void> => {
  for (const name of ['mutation-report.json', 'mutation-stream.jsonl']) {
    await Deno.remove(join(reportsDir, name)).catch((error) => {
      if (!(error instanceof Deno.errors.NotFound)) throw error
    })
  }
}

const strykerUnderCap = async (name: string, shard: Shard | undefined, capSeconds: number): Promise<number> => {
  const { code } = await new Deno.Command('timeout', {
    args: [
      '--kill-after=60',
      String(capSeconds),
      'pnpm',
      '--filter',
      name,
      'mutation',
      '--incrementalFile',
      incrementalFileOf(shard),
    ],
    env: { STRYKER_SHARD: shard === undefined ? '' : `${shard.index}/${shard.count}` },
    stdout: 'inherit',
    stderr: 'inherit',
  }).output()
  return code
}

const runJob = async (job: Job, capSeconds: number, budgetSeconds: number): Promise<boolean> => {
  const shard = shardOfJob(job)
  const incrementalFile = incrementalFileOf(shard)
  const entries: Entry[] = []
  const jobStarted = Date.now()
  let ok = true
  for (const [position, name] of job.packages.entries()) {
    const dir = job.dirs[position]
    if (dir === undefined) throw new Error(`job ${job.id} names ${name} without a directory`)
    const started = Date.now()
    const cap = Math.min(capSeconds, budgetSeconds - Math.round((started - jobStarted) / 1000))
    let exitCode: number | null = null
    if (cap > 0) {
      await removeOutputsOfEarlierRun(join(dir, 'reports'))
      console.log(`::group::mutation ${labelOf(dir, shard)}`)
      exitCode = await strykerUnderCap(name, shard, cap)
      console.log('::endgroup::')
    } else {
      console.log(`${name}: skipped, the job's ${budgetSeconds}s budget is spent`)
    }
    if (exitCode !== null) {
      entries.push({
        package: name,
        seconds: Math.round((Date.now() - started) / 1000),
        exitCode,
        ...(shard === undefined ? {} : { shard }),
      })
      await Deno.mkdir('.timings', { recursive: true })
      await Deno.writeTextFile(
        join('.timings', `${job.id}.json`),
        JSON.stringify({ job: job.id, entries } satisfies Part),
      )
    }
    const outcome: Outcome = exitCode === 0 ? 'success' : 'failure'
    const reportsDir = join(dir, 'reports')
    const input = { package: labelOf(dir, shard), outcome, reportsDir, readFile: readText }
    console.log(await buildSummary(input))
    const missing = buildRequireError(input, await loadState(reportsDir, readText))
    if (missing !== null) {
      console.log(missing)
      ok = false
    }

    const part = join('mutation-parts', slugOf(dir), shard === undefined ? 'whole' : `${shard.index}of${shard.count}`)
    await Deno.mkdir(part, { recursive: true })
    await Deno.writeTextFile(
      join(part, 'mutation-part.json'),
      JSON.stringify({ package: dir, outcome, ...(shard === undefined ? {} : { shard }) } satisfies PartMeta),
    )
    await copyIfPresent(join(reportsDir, 'mutation-report.json'), join(part, 'mutation-report.json'))
    await copyIfPresent(join(reportsDir, 'mutation-stream.jsonl'), join(part, 'mutation-stream.jsonl'))
    await copyIfPresent(join(dir, incrementalFile), join('incremental', dir, incrementalFile))
  }
  return ok
}

const plannedPackages = (jobs: readonly Job[]): string[] => [...new Set(jobs.flatMap((job) => job.dirs))].sort()

const readStagedParts = async (root: string): Promise<StagedPart[]> => {
  const parts: StagedPart[] = []
  for await (const marker of expandGlob('**/mutation-part.json', { root })) {
    const dir = dirname(marker.path)
    const report = await readIfPresent(join(dir, 'mutation-report.json'))
    const stream = await readIfPresent(join(dir, 'mutation-stream.jsonl'))
    parts.push({
      meta: JSON.parse(await Deno.readTextFile(marker.path)) as PartMeta,
      ...(report === undefined ? {} : { report: JSON.parse(report) as Report }),
      ...(stream === undefined ? {} : { stream }),
    })
  }
  return parts
}

const writeCombined = async (
  out: string,
  combined: ReadonlyMap<string, { meta: PartMeta; report?: Report; stream?: string }>,
): Promise<void> => {
  for (const [dir, part] of combined) {
    const target = join(out, slugOf(dir))
    await Deno.mkdir(target, { recursive: true })
    await Deno.writeTextFile(join(target, 'mutation-part.json'), JSON.stringify(part.meta))
    if (part.report !== undefined) {
      await Deno.writeTextFile(join(target, 'mutation-report.json'), JSON.stringify(part.report))
    }
    if (part.stream !== undefined) await Deno.writeTextFile(join(target, 'mutation-stream.jsonl'), part.stream)
  }
}

const main = async (): Promise<void> => {
  const [command, ...rest] = Deno.args
  const args = parseArgs(rest, { string: ['cap-seconds', 'budget-seconds', 'parts', 'out'] })
  if (command === 'run') {
    const job = JSON.parse(Deno.env.get('JOB') ?? 'null') as Job | null
    if (job === null) throw new Error('run needs JOB, one job from `mutation-timings.ts plan`')
    if (args['cap-seconds'] === undefined || args['budget-seconds'] === undefined) {
      throw new Error('run needs --cap-seconds and --budget-seconds')
    }
    if (!await runJob(job, Number(args['cap-seconds']), Number(args['budget-seconds']))) Deno.exit(1)
    return
  }
  if (command === 'combine') {
    if (args.parts === undefined || args.out === undefined) throw new Error('combine needs --parts and --out')
    const jobs = JSON.parse(Deno.env.get('JOBS') ?? '[]') as Job[]
    await writeCombined(args.out, combineParts(await readStagedParts(args.parts)))
    const envFile = Deno.env.get('GITHUB_ENV')
    const packages = JSON.stringify(plannedPackages(jobs))
    if (envFile !== undefined && envFile !== '') {
      await Deno.writeTextFile(envFile, `PACKAGES=${packages}\n`, { append: true })
    }
    console.log(`planned packages: ${packages}`)
    return
  }
  throw new Error(`unknown command ${command ?? '(none)'}: expected run or combine`)
}

if (import.meta.main) await main()
