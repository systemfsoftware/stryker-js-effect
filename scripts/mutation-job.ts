#!/usr/bin/env -S deno run --allow-read --allow-write --allow-env --allow-run=timeout

import { parseArgs } from '@std/cli/parse-args'
import { expandGlob } from '@std/fs/expand-glob'
import { dirname, join } from '@std/path'
import * as Option from 'effect/Option'

import {
  buildPreflightError,
  buildPreflightSummary,
  buildRequireError,
  buildSummary,
  type CombinedPart,
  combineParts,
  decodeJson,
  type Entry,
  evaluatedOf,
  evaluatedSummaryOf,
  type Job,
  JobOrNullSchema,
  JobsSchema,
  loadState,
  mergeSarif,
  type Outcome,
  type PackageSarif,
  type Part,
  type PartMeta,
  PartMetaSchema,
  PREFLIGHT_FILE,
  ReportSchema,
  SarifLogSchema,
  type Shard,
  slugOf,
  type StagedPart,
} from './lib/mutation-plan.ts'

const PART_SARIF = 'mutation.sarif'

const incrementalFileOf = (shard: Shard | undefined): string =>
  shard === undefined
    ? 'reports/stryker-incremental.json'
    : `reports/stryker-incremental-${shard.index}of${shard.count}.json`

const labelOf = (dir: string, shard: Shard | undefined): string =>
  shard === undefined ? dir : `${dir} (${shard.index}/${shard.count})`

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

const strykerUnderCap = async (
  name: string,
  shard: Shard | undefined,
  capSeconds: number,
  args: readonly string[],
): Promise<number> => {
  const { code } = await new Deno.Command('timeout', {
    args: ['--kill-after=60', String(capSeconds), 'pnpm', '--filter', name, 'mutation', ...args],
    env: { STRYKER_SHARD: shard === undefined ? '' : `${shard.index}/${shard.count}` },
    stdout: 'inherit',
    stderr: 'inherit',
  }).output()
  return code
}

const runJob = async (job: Job, capSeconds: number, budgetSeconds: number): Promise<boolean> => {
  const shard = job.shard
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
    await removeOutputsOfEarlierRun(join(dir, 'reports'))
    if (cap > 0) {
      console.log(`::group::mutation ${labelOf(dir, shard)}`)
      exitCode = await strykerUnderCap(name, shard, cap, ['--incrementalFile', incrementalFileOf(shard)])
      console.log('::endgroup::')
    } else {
      console.log(`${name}: skipped, the job's ${budgetSeconds}s budget is spent`)
      ok = false
    }
    const seconds = Math.round((Date.now() - started) / 1000)
    const outcome: Outcome = exitCode === 0 ? 'success' : 'failure'
    const reportsDir = join(dir, 'reports')
    const input = { package: labelOf(dir, shard), outcome, reportsDir, exitCode, cwd: Deno.cwd(), limitSeconds: cap }
    const state = await loadState(reportsDir, readText)
    if (exitCode !== null) {
      entries.push({
        package: name,
        seconds,
        exitCode,
        ...(shard === undefined ? {} : { shard }),
        ...Option.match(state.reuse, { onNone: () => ({}), onSome: ({ ran, reused }) => ({ ran, reused }) }),
      })
      await Deno.mkdir('.timings', { recursive: true })
      await Deno.writeTextFile(
        join('.timings', `${job.id}.json`),
        JSON.stringify({ job: job.id, entries } satisfies Part),
      )
    }
    console.log(buildSummary(input, state))
    const missing = buildRequireError(input, state)
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
    await copyIfPresent(join(reportsDir, 'mutation-report.sarif'), join(part, PART_SARIF))
    await copyIfPresent(join(reportsDir, 'mutation', 'failure.json'), join(part, 'failure.json'))
    await copyIfPresent(join(dir, incrementalFile), join('incremental', dir, incrementalFile))
  }
  return ok
}

const plannedPackages = (jobs: readonly Job[]): string[] => [...new Set(jobs.flatMap((job) => job.dirs))].sort()

const namedPackagesOf = (jobs: readonly Job[]): ReadonlyMap<string, string> =>
  new Map(jobs.flatMap((job) => job.dirs.map((dir, position) => [dir, job.packages[position] ?? dir] as const)))

const preflightPackage = async (name: string, dir: string, capSeconds: number): Promise<boolean> => {
  const reportsDir = join(dir, 'reports')
  await removeOutputsOfEarlierRun(reportsDir)
  console.log(`::group::preflight ${dir}`)
  const exitCode = await strykerUnderCap(name, undefined, capSeconds, [
    '--dryRunOnly',
    '--incrementalFile',
    PREFLIGHT_FILE,
  ])
  console.log('::endgroup::')
  const outcome: Outcome = exitCode === 0 ? 'success' : 'failure'
  const input = { package: dir, outcome, reportsDir, exitCode, cwd: Deno.cwd(), limitSeconds: capSeconds }
  const state = await loadState(reportsDir, readText)
  const published = (await readIfPresent(join(dir, PREFLIGHT_FILE))) !== undefined
  console.log(buildPreflightSummary(input, state, published))
  const error = buildPreflightError(input, state)
  if (error !== null) console.log(error)
  await copyIfPresent(join(dir, PREFLIGHT_FILE), join('preflight', dir, PREFLIGHT_FILE))
  await copyIfPresent(
    join(reportsDir, 'mutation-stream.jsonl'),
    join('preflight-evidence', dir, 'mutation-stream.jsonl'),
  )
  await copyIfPresent(join(reportsDir, 'mutation', 'failure.json'), join('preflight-evidence', dir, 'failure.json'))
  return outcome === 'success'
}

const preflight = async (jobs: readonly Job[], capSeconds: number): Promise<boolean> => {
  let ok = true
  let coverage = false
  for (const [dir, name] of [...namedPackagesOf(jobs)].sort(([a], [b]) => a.localeCompare(b))) {
    if (!await preflightPackage(name, dir, capSeconds)) ok = false
    if ((await readIfPresent(join('preflight', dir, PREFLIGHT_FILE))) !== undefined) coverage = true
  }
  await appendTo('GITHUB_OUTPUT', `coverage=${coverage}\n`)
  return ok
}

const readPackageSarifs = async (root: string): Promise<PackageSarif[]> => {
  const sarifs: PackageSarif[] = []
  for await (const marker of expandGlob('**/mutation-part.json', { root })) {
    const sarifPath = join(dirname(marker.path), PART_SARIF)
    const text = await readIfPresent(sarifPath)
    if (text === undefined) continue
    const meta = decodeJson(PartMetaSchema, await Deno.readTextFile(marker.path), marker.path)
    sarifs.push({ dir: meta.package, log: decodeJson(SarifLogSchema, text, sarifPath) })
  }
  return sarifs
}

const appendTo = async (variable: string, text: string): Promise<void> => {
  const file = Deno.env.get(variable)
  if (file !== undefined && file !== '') await Deno.writeTextFile(file, text, { append: true })
}

const readStagedParts = async (root: string): Promise<StagedPart[]> => {
  const parts: StagedPart[] = []
  for await (const marker of expandGlob('**/mutation-part.json', { root })) {
    const dir = dirname(marker.path)
    const reportPath = join(dir, 'mutation-report.json')
    const report = await readIfPresent(reportPath)
    const stream = await readIfPresent(join(dir, 'mutation-stream.jsonl'))
    parts.push({
      meta: decodeJson(PartMetaSchema, await Deno.readTextFile(marker.path), marker.path),
      ...(report === undefined ? {} : { report: decodeJson(ReportSchema, report, reportPath) }),
      ...(stream === undefined ? {} : { stream }),
    })
  }
  return parts
}

const writeCombined = async (out: string, combined: ReadonlyMap<string, CombinedPart>): Promise<void> => {
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
    const job = decodeJson(JobOrNullSchema, Deno.env.get('JOB') ?? 'null', 'JOB')
    if (job === null) throw new Error('run needs JOB, one job from `mutation-timings.ts plan`')
    if (args['cap-seconds'] === undefined || args['budget-seconds'] === undefined) {
      throw new Error('run needs --cap-seconds and --budget-seconds')
    }
    if (!await runJob(job, Number(args['cap-seconds']), Number(args['budget-seconds']))) Deno.exit(1)
    return
  }
  if (command === 'preflight') {
    if (args['cap-seconds'] === undefined) throw new Error('preflight needs --cap-seconds')
    const jobs = decodeJson(JobsSchema, Deno.env.get('JOBS') ?? '[]', 'JOBS')
    if (!await preflight(jobs, Number(args['cap-seconds']))) Deno.exit(1)
    return
  }
  if (command === 'combine') {
    if (args.parts === undefined || args.out === undefined) throw new Error('combine needs --parts and --out')
    const jobs = decodeJson(JobsSchema, Deno.env.get('JOBS') ?? '[]', 'JOBS')
    const staged = await readStagedParts(args.parts)
    const combined = combineParts(staged)
    await writeCombined(args.out, combined)
    const packages = JSON.stringify(plannedPackages(jobs))
    const complete = combined.size > 0 && [...combined.values()].every((part) => part.report !== undefined)
    await appendTo('GITHUB_ENV', `PACKAGES=${packages}\nMUTATION_REPORT_COMPLETE=${complete}\n`)
    const evaluated = evaluatedOf(staged.flatMap((part) => (part.stream === undefined ? [] : [part.stream])))
    const evaluatedLine = evaluatedSummaryOf(evaluated)
    await appendTo('GITHUB_STEP_SUMMARY', `${evaluatedLine}\n`)
    if (Option.contains(evaluated, 0)) {
      console.log('::notice title=Mutation evaluated no mutants::every verdict was reused, so this run tested nothing')
    }
    console.log(`planned packages: ${packages}`)
    console.log(evaluatedLine)
    return
  }
  if (command === 'sarif') {
    if (args.parts === undefined || args.out === undefined) throw new Error('sarif needs --parts and --out')
    const merged = Option.getOrUndefined(mergeSarif(await readPackageSarifs(args.parts)))
    if (merged !== undefined) {
      await Deno.mkdir(dirname(args.out), { recursive: true })
      await Deno.writeTextFile(args.out, JSON.stringify(merged))
    }
    console.log(merged === undefined ? 'no part carried a SARIF log' : `wrote ${args.out}`)
    return
  }
  throw new Error(`unknown command ${command ?? '(none)'}: expected run, preflight, combine or sarif`)
}

if (import.meta.main) await main()
