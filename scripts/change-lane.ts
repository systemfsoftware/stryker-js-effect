#!/usr/bin/env -S deno run --allow-env=GITHUB_EVENT_NAME,GITHUB_OUTPUT,GITHUB_STEP_SUMMARY --allow-write
import { Buffer } from 'node:buffer'
import { appendFile } from 'node:fs/promises'
import process from 'node:process'

export type Lane = 'docs-only' | 'full'

export interface LaneDecision {
  readonly lane: Lane
  readonly why: string
  readonly paths: ReadonlyArray<string>
}

const ROOT_DOCS: ReadonlyArray<string> = ['README.md', 'AGENTS.md', 'STRATEGY.md']
const DOCS_DIRECTORY = 'docs/'
const MARKDOWN = '.md'
const SKIPPABLE_EVENT = 'pull_request'

export const isDocPath = (path: string): boolean =>
  ROOT_DOCS.includes(path) || (path.startsWith(DOCS_DIRECTORY) && path.endsWith(MARKDOWN))

export const laneOf = (event: string, paths: ReadonlyArray<string>): LaneDecision => {
  if (event !== SKIPPABLE_EVENT) {
    return { lane: 'full', why: `${event || 'an unnamed event'} always runs every lane`, paths }
  }
  if (paths.length === 0) {
    return { lane: 'full', why: 'the diff lists no files', paths }
  }
  const code = paths.filter((path) => !isDocPath(path))
  return code.length === 0
    ? { lane: 'docs-only', why: 'every changed file is a doc', paths }
    : { lane: 'full', why: `${code.length} non-doc file(s), first \`${code[0]}\``, paths }
}

export const summaryOf = (decision: LaneDecision): string =>
  decision.lane === 'docs-only'
    ? [
      `docs-only: heavy lanes skipped (${decision.paths.length} file(s))`,
      '',
      ...decision.paths.map((path) => `- \`${path}\``),
      '',
    ].join('\n')
    : `full: every lane runs; ${decision.why}\n`

export const pathsOf = (stdin: string): ReadonlyArray<string> => stdin.split('\0').filter((path) => path !== '')

const readStdin = async (): Promise<string> => {
  const chunks: Array<Buffer> = []
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks).toString('utf8')
}

if (import.meta.main) {
  const decision = laneOf(process.env['GITHUB_EVENT_NAME'] ?? '', pathsOf(await readStdin()))
  const summary = summaryOf(decision)
  process.stdout.write(summary)
  const output = process.env['GITHUB_OUTPUT']
  if (output) await appendFile(output, `docs-only=${decision.lane === 'docs-only'}\n`)
  const stepSummary = process.env['GITHUB_STEP_SUMMARY']
  if (stepSummary) await appendFile(stepSummary, summary)
}
