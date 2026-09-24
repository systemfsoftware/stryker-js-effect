import type { Ignorer, Node } from '@systemfsoftware/stryker-ignorer-interface'
import { parseSync } from 'oxc-parser'
import { parseAndWalk } from 'oxc-walker'

import { IgnorerCaseFailed, reasonSuffix } from './case-failure.js'

export type ScriptLang = 'js' | 'jsx' | 'ts' | 'tsx'

export interface IgnoredSpan {
  readonly text: string
  readonly reason?: string
}

export interface IgnoredCase {
  readonly name: string
  readonly code: string
  readonly lang?: ScriptLang
  readonly ignores: readonly (string | IgnoredSpan)[]
  readonly keeps?: readonly string[]
}

export interface KeptCase {
  readonly name: string
  readonly code: string
  readonly lang?: ScriptLang
  readonly keeps?: readonly string[]
}

export interface IgnorerCases {
  readonly ignored?: readonly IgnoredCase[]
  readonly kept?: readonly KeptCase[]
}

interface ReceivedSpan {
  readonly text: string
  readonly reason: string
  readonly type: string
}

interface CaseFile {
  readonly kind: 'kept' | 'ignored'
  readonly name: string
  readonly code: string
  readonly lang: ScriptLang
  readonly expects: readonly IgnoredSpan[]
  readonly keeps: readonly string[]
}

interface CaseOutcome {
  readonly file: CaseFile
  readonly passed: boolean
  readonly failures: readonly string[]
  readonly received: readonly ReceivedSpan[]
}

interface Runner {
  describe(name: string, fn: () => void): void
  it(name: string, fn: () => Promise<void>): void
}

const FILE_NAMES: Record<ScriptLang, string> = {
  js: 'case.js',
  jsx: 'case.jsx',
  ts: 'case.ts',
  tsx: 'case.tsx',
}

const toSpan = (expect: string | IgnoredSpan): IgnoredSpan => typeof expect === 'string' ? { text: expect } : expect

const langOf = (one: { readonly lang?: ScriptLang }) => one.lang ?? 'ts'

const keepsOf = (one: { readonly keeps?: readonly string[] }) => one.keeps ?? []

const toKept = (one: KeptCase): CaseFile => ({
  kind: 'kept',
  name: one.name,
  code: one.code,
  lang: langOf(one),
  expects: [],
  keeps: keepsOf(one),
})

const toIgnored = (one: IgnoredCase): CaseFile => ({
  kind: 'ignored',
  name: one.name,
  code: one.code,
  lang: langOf(one),
  expects: one.ignores.map(toSpan),
  keeps: keepsOf(one),
})

const keptFiles = (kept: readonly KeptCase[] | undefined) => (kept ?? []).map(toKept)

const ignoredFiles = (ignored: readonly IgnoredCase[] | undefined) => (ignored ?? []).map(toIgnored)

const toFiles = (cases: IgnorerCases): readonly CaseFile[] => [...keptFiles(cases.kept), ...ignoredFiles(cases.ignored)]

const parseFailure = (errors: readonly { message: string }[]) =>
  `parse failed: ${errors.map((error) => error.message).join('; ')}`

const allIgnoredFailures = (received: readonly ReceivedSpan[]) =>
  received.length === 0 ? [] : [`expected nothing ignored, received ${received.length} span(s)`]

const keepFailure = (received: readonly ReceivedSpan[], keep: string) => {
  const hit = received.find((span) => span.text === keep)
  return hit === undefined
    ? []
    : [`expected span ${JSON.stringify(keep)} to stay live, but it was ignored${reasonSuffix(hit.reason)}`]
}

const keepFailures = (file: CaseFile, received: readonly ReceivedSpan[]) =>
  file.keeps.flatMap((keep) => keepFailure(received, keep))

const keptFailures = (file: CaseFile, received: readonly ReceivedSpan[]) =>
  file.keeps.length === 0 ? allIgnoredFailures(received) : keepFailures(file, received)

const keptOutcome = (file: CaseFile, received: readonly ReceivedSpan[]) => {
  const failures = keptFailures(file, received)
  return { file, passed: failures.length === 0, failures, received }
}

const reasonMatches = (actual: string, pinned: string | undefined) => pinned === undefined || actual === pinned

const spansMatch = (span: ReceivedSpan, expect: IgnoredSpan) =>
  span.text === expect.text && reasonMatches(span.reason, expect.reason)

const pinnedSuffix = (expect: IgnoredSpan) =>
  expect.reason === undefined ? '' : ` with reason ${JSON.stringify(expect.reason)}`

const missingMessage = (expect: IgnoredSpan) =>
  `expected ignored span ${JSON.stringify(expect.text)}${pinnedSuffix(expect)} was not ignored`

const expectFailures = (pool: ReceivedSpan[], expect: IgnoredSpan) => {
  const at = pool.findIndex((span) => spansMatch(span, expect))
  pool.splice(at, Number(at !== -1))
  return at === -1 ? [missingMessage(expect)] : []
}

const ignoredOutcome = (file: CaseFile, received: readonly ReceivedSpan[]) => {
  const pool = [...received]
  const failures = [
    ...file.expects.flatMap((expect) => expectFailures(pool, expect)),
    ...keepFailures(file, received),
  ]
  return { file, passed: failures.length === 0, failures, received }
}

const OUTCOME_OF: Record<CaseFile['kind'], (file: CaseFile, received: readonly ReceivedSpan[]) => CaseOutcome> = {
  kept: keptOutcome,
  ignored: ignoredOutcome,
}

const judge = (file: CaseFile, received: readonly ReceivedSpan[]) => OUTCOME_OF[file.kind](file, received)

const receivedOf = (subject: Ignorer, file: CaseFile, node: Node, ancestors: readonly Node[]) => {
  const reason = subject.shouldIgnore(node, ancestors)
  return reason === undefined
    ? []
    : [{ text: file.code.slice(node.start, node.end), reason, type: node.type }]
}

const collect = (subject: Ignorer, file: CaseFile): readonly ReceivedSpan[] | string => {
  const visits: [Node, Node[]][] = []
  const ancestors: Node[] = []
  const result = parseAndWalk(file.code, FILE_NAMES[file.lang], {
    parseSync,
    parseOptions: { lang: file.lang, range: true },
    enter(node) {
      visits.push([node, [...ancestors]])
      ancestors.unshift(node)
    },
    leave() {
      ancestors.shift()
    },
  })
  return result.errors.length > 0
    ? parseFailure(result.errors)
    : visits.flatMap(([node, chain]) => receivedOf(subject, file, node, chain))
}

const outcomeOf = (subject: Ignorer, file: CaseFile): CaseOutcome => {
  const result = collect(subject, file)
  return typeof result === 'string'
    ? { file, passed: false, failures: [result], received: [] }
    : judge(file, result)
}

const isDescribe = (value: unknown): value is Runner['describe'] => typeof value === 'function'

const isIt = (value: unknown): value is Runner['it'] => typeof value === 'function'

const globalDescribe = () => {
  const value: unknown = Reflect.get(globalThis, 'describe')
  return isDescribe(value) ? value : undefined
}

const globalIt = () => {
  const value: unknown = Reflect.get(globalThis, 'it')
  return isIt(value) ? value : undefined
}

const withIt = (describe: Runner['describe']) => {
  const it = globalIt()
  return it === undefined ? undefined : { describe, it }
}

const runner = () => {
  const describe = globalDescribe()
  return describe === undefined ? undefined : withIt(describe)
}

const directRun = (subject: Ignorer, files: readonly CaseFile[]): Promise<void> => {
  const failed = files.map((file) => outcomeOf(subject, file)).filter((outcome) => outcome.passed === false)
  return failed.length === 0
    ? Promise.resolve()
    : Promise.reject(new IgnorerCaseFailed(failed))
}

const registerCase = (run: Runner, subject: Ignorer, file: CaseFile) => {
  run.it(file.name, () => {
    const outcome = outcomeOf(subject, file)
    return outcome.passed
      ? Promise.resolve()
      : Promise.reject(new IgnorerCaseFailed([outcome]))
  })
}

const registerAll = (run: Runner, subject: Ignorer, files: readonly CaseFile[]) => {
  run.describe(subject.name, () => {
    files.map((file) => registerCase(run, subject, file))
  })
}

/**
 * Parses each case with the instrumenter's parser convention, walks with host-shaped
 * ancestor semantics, and consults the subject at every node. With runner globals present
 * this registers one test per case under the subject's name; without them it runs every
 * case here and rejects with one error enumerating every failing case.
 */
export async function testIgnorer(subject: Ignorer, cases: IgnorerCases): Promise<void> {
  const run = runner()
  const files = toFiles(cases)
  return run === undefined ? directRun(subject, files) : Promise.resolve(registerAll(run, subject, files))
}
