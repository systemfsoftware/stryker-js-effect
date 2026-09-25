#!/usr/bin/env -S deno run --allow-read --allow-write --allow-env

import { parseArgs } from '@std/cli/parse-args'
import { expandGlob } from '@std/fs/expand-glob'
import { dirname, join, relative } from '@std/path'
import { parse } from '@std/yaml'

import {
  emptyRecord,
  mergeRecord,
  minutes,
  type MutationPackage,
  type Part,
  planJobs,
  summaryTable,
  type TimingRecord,
} from './lib/mutation-plan.ts'

const readJson = async <T>(path: string, fallback: T): Promise<T> => {
  try {
    return JSON.parse(await Deno.readTextFile(path)) as T
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return fallback
    throw error
  }
}

const readRecord = async (path: string | undefined): Promise<TimingRecord> => {
  if (path === undefined) return emptyRecord
  const found = await readJson<Partial<TimingRecord>>(path, {})
  return found.version === 1 && typeof found.packages === 'object' ? found as TimingRecord : emptyRecord
}

const workspacePackagesWithMutation = async (root: string): Promise<MutationPackage[]> => {
  const doc = parse(await Deno.readTextFile(join(root, 'pnpm-workspace.yaml'))) as { packages?: string[] }
  const found: MutationPackage[] = []
  for (const glob of doc.packages ?? []) {
    for await (const manifest of expandGlob(join(glob, 'package.json'), { root, exclude: ['**/node_modules/**'] })) {
      const json = JSON.parse(await Deno.readTextFile(manifest.path)) as {
        name?: string
        scripts?: Record<string, string>
      }
      if (json.name === undefined || json.scripts?.['mutation'] === undefined) continue
      found.push({ name: json.name, dir: relative(root, dirname(manifest.path)) })
    }
  }
  return found.sort((a, b) => a.name.localeCompare(b.name))
}

const readParts = async (dir: string): Promise<Part[]> => {
  const parts: Part[] = []
  try {
    for await (const entry of expandGlob('**/*.json', { root: dir })) {
      parts.push(await readJson<Part>(entry.path, { job: entry.name, entries: [] }))
    }
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) throw error
  }
  return parts.sort((a, b) => a.job.localeCompare(b.job))
}

const appendEnvFile = async (variable: string, text: string): Promise<void> => {
  const path = Deno.env.get(variable)
  if (path !== undefined && path !== '') await Deno.writeTextFile(path, text, { append: true })
}

const main = async (): Promise<void> => {
  const [command, ...rest] = Deno.args
  const args = parseArgs(rest, {
    string: ['record', 'previous', 'parts', 'out', 'sha'],
    default: { target: '900', 'max-jobs': '20', 'unknown-seconds': '900' },
  })
  const target = Number(args.target)
  if (command === 'plan') {
    const record = await readRecord(args.record)
    const plan = planJobs(await workspacePackagesWithMutation(Deno.cwd()), record, {
      target,
      maxJobs: Number(args['max-jobs']),
      unknownSeconds: Number(args['unknown-seconds']),
    })
    for (const job of plan.jobs) console.log(`${job.id.padEnd(28)} ~${minutes(job.predicted)}  ${job.name}`)
    await appendEnvFile('GITHUB_OUTPUT', `jobs=${JSON.stringify(plan.jobs)}\n`)
    return
  }
  if (command === 'merge') {
    if (args.parts === undefined || args.out === undefined) throw new Error('merge needs --parts and --out')
    const parts = await readParts(args.parts)
    const record = mergeRecord(await readRecord(args.previous), parts, args.sha ?? '')
    await Deno.writeTextFile(args.out, JSON.stringify(record, null, 2))
    const table = summaryTable(parts, target)
    console.log(table)
    await appendEnvFile('GITHUB_STEP_SUMMARY', table)
    return
  }
  throw new Error(`unknown command ${command ?? '(none)'}: expected plan or merge`)
}

if (import.meta.main) await main()
