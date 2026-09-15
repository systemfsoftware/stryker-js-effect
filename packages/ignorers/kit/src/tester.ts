import type { Ignorer, Node } from '@systemfsoftware/stryker-ignorer-interface'
import type * as OxcParser from 'oxc-parser'
import { walk } from 'oxc-walker'

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

interface ReceivedSpan extends IgnoredSpan {
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

type WalkRoot = Parameters<typeof walk>[0]

type OxcModule = typeof OxcParser

let oxc: OxcModule | undefined

async function loadOxc(): Promise<OxcModule> {
  if (oxc === undefined) {
    // A static import cannot work here: oxc-parser constructs its native/WASM parser
    // machinery at module load (instrumenter rule IN5); this entry must stay load-free
    // until its first case runs.
    oxc = await import('oxc-parser')
  }
  return oxc
}

const fileNames: Record<ScriptLang, string> = {
  js: 'case.js',
  jsx: 'case.jsx',
  ts: 'case.ts',
  tsx: 'case.tsx',
}

function isObjectValue(value: unknown): value is object {
  return typeof value === 'object' && value !== null
}

function hasStringType(value: object): boolean {
  return 'type' in value && typeof value.type === 'string'
}

function isNode(value: unknown): value is Node {
  return isObjectValue(value) && hasStringType(value)
}

function asNode(value: unknown): Node | undefined {
  return isNode(value) ? value : undefined
}

function isWalkRoot(value: unknown): value is WalkRoot {
  return isNode(value)
}

function toSpan(expect: string | IgnoredSpan): IgnoredSpan {
  return typeof expect === 'string' ? { text: expect } : expect
}

function langOf(one: { readonly lang?: ScriptLang }): ScriptLang {
  return one.lang ?? 'ts'
}

function keepsOf(one: { readonly keeps?: readonly string[] }): readonly string[] {
  return one.keeps ?? []
}

function toKept(one: KeptCase): CaseFile {
  return { kind: 'kept', name: one.name, code: one.code, lang: langOf(one), expects: [], keeps: keepsOf(one) }
}

function toIgnored(one: IgnoredCase): CaseFile {
  return {
    kind: 'ignored',
    name: one.name,
    code: one.code,
    lang: langOf(one),
    expects: one.ignores.map(toSpan),
    keeps: keepsOf(one),
  }
}

function keptFiles(kept: readonly KeptCase[] | undefined): readonly CaseFile[] {
  return (kept ?? []).map(toKept)
}

function ignoredFiles(ignored: readonly IgnoredCase[] | undefined): readonly CaseFile[] {
  return (ignored ?? []).map(toIgnored)
}

function toFiles(cases: IgnorerCases): readonly CaseFile[] {
  return [...keptFiles(cases.kept), ...ignoredFiles(cases.ignored)]
}

function errorMessage(error: { message: string }): string {
  return error.message
}

function parseFailure(errors: readonly { message: string }[]): string {
  return `parse failed: ${errors.map(errorMessage).join('; ')}`
}

function recordIfIgnored(
  subject: Ignorer,
  node: Node,
  ancestors: Node[],
  received: ReceivedSpan[],
  file: CaseFile,
): void {
  const reason = subject.shouldIgnore(node, [...ancestors])
  if (reason !== undefined) {
    received.push({ text: file.code.slice(node.start, node.end), reason, type: node.type })
  }
}

function collect(subject: Ignorer, file: CaseFile, program: WalkRoot): readonly ReceivedSpan[] {
  const received: ReceivedSpan[] = []
  const ancestors: Node[] = []
  walk(program, {
    enter(walked) {
      const node = asNode(walked)
      if (node === undefined) return
      recordIfIgnored(subject, node, ancestors, received, file)
      ancestors.unshift(node)
    },
    leave(walked) {
      if (asNode(walked) !== undefined) ancestors.shift()
    },
  })
  return received
}

function asWalkRoot(value: unknown): WalkRoot | string {
  return isWalkRoot(value) ? value : 'parse produced no walkable program'
}

async function parseProgram(file: CaseFile): Promise<WalkRoot | string> {
  const { parseSync } = await loadOxc()
  const result = parseSync(fileNames[file.lang], file.code, { lang: file.lang, range: true })
  if (result.errors.length > 0) return parseFailure(result.errors)
  return asWalkRoot(result.program)
}

async function receive(subject: Ignorer, file: CaseFile): Promise<readonly ReceivedSpan[] | string> {
  const program = await parseProgram(file)
  return typeof program === 'string' ? program : collect(subject, file, program)
}

function allIgnoredFailures(received: readonly ReceivedSpan[]): string[] {
  return received.length === 0 ? [] : [`expected nothing ignored, received ${received.length} span(s)`]
}

function keepFailure(received: readonly ReceivedSpan[], keep: string): string[] {
  const hit = received.find((span) => span.text === keep)
  return hit === undefined
    ? []
    : [`expected span ${JSON.stringify(keep)} to stay live, but it was ignored${reasonSuffix(hit.reason)}`]
}

function keepFailures(file: CaseFile, received: readonly ReceivedSpan[]): string[] {
  return file.keeps.flatMap((keep) => keepFailure(received, keep))
}

function keptFailures(file: CaseFile, received: readonly ReceivedSpan[]): string[] {
  return file.keeps.length === 0 ? allIgnoredFailures(received) : keepFailures(file, received)
}

function keptOutcome(file: CaseFile, received: readonly ReceivedSpan[]): CaseOutcome {
  const failures = keptFailures(file, received)
  return { file, passed: failures.length === 0, failures, received }
}

function reasonMatches(actual: string | undefined, pinned: string | undefined): boolean {
  return pinned === undefined || actual === pinned
}

function spansMatch(span: ReceivedSpan, expect: IgnoredSpan): boolean {
  return span.text === expect.text && reasonMatches(span.reason, expect.reason)
}

function pinnedSuffix(expect: IgnoredSpan): string {
  return expect.reason === undefined ? '' : ` with reason ${JSON.stringify(expect.reason)}`
}

function missingMessage(expect: IgnoredSpan): string {
  return `expected ignored span ${JSON.stringify(expect.text)}${pinnedSuffix(expect)} was not ignored`
}

function expectFailures(pool: ReceivedSpan[], expect: IgnoredSpan): string[] {
  const at = pool.findIndex((span) => spansMatch(span, expect))
  if (at === -1) return [missingMessage(expect)]
  pool.splice(at, 1)
  return []
}

function ignoredOutcome(file: CaseFile, received: readonly ReceivedSpan[]): CaseOutcome {
  const pool = [...received]
  const failures = [
    ...file.expects.flatMap((expect) => expectFailures(pool, expect)),
    ...keepFailures(file, received),
  ]
  return { file, passed: failures.length === 0, failures, received }
}

function judge(file: CaseFile, received: readonly ReceivedSpan[]): CaseOutcome {
  return file.kind === 'kept' ? keptOutcome(file, received) : ignoredOutcome(file, received)
}

function reasonSuffix(reason: string | undefined): string {
  return reason === undefined ? '' : ` reason ${JSON.stringify(reason)}`
}

function spanLine(span: ReceivedSpan): string {
  return `- ${JSON.stringify(span.text)} (${span.type})${reasonSuffix(span.reason)}`
}

function failureLine(failure: string): string {
  return `- ${failure}`
}

function receivedLines(received: readonly ReceivedSpan[]): string[] {
  return received.length === 0 ? ['- none'] : received.map(spanLine)
}

function messageFor(outcome: CaseOutcome): string {
  return [
    `case ${JSON.stringify(outcome.file.name)} (${outcome.file.kind}) failed:`,
    'code:',
    outcome.file.code,
    'failures:',
    ...outcome.failures.map(failureLine),
    'received ignored spans:',
    ...receivedLines(outcome.received),
  ].join('\n')
}

async function outcomeOf(subject: Ignorer, file: CaseFile): Promise<CaseOutcome> {
  const result = await receive(subject, file)
  return typeof result === 'string'
    ? { file, passed: false, failures: [result], received: [] }
    : judge(file, result)
}

function isDescribe(value: unknown): value is Runner['describe'] {
  return typeof value === 'function'
}

function isIt(value: unknown): value is Runner['it'] {
  return typeof value === 'function'
}

function globalDescribe(): Runner['describe'] | undefined {
  const value: unknown = Reflect.get(globalThis, 'describe')
  return isDescribe(value) ? value : undefined
}

function globalIt(): Runner['it'] | undefined {
  const value: unknown = Reflect.get(globalThis, 'it')
  return isIt(value) ? value : undefined
}

function withIt(describe: Runner['describe']): Runner | undefined {
  const it = globalIt()
  return it === undefined ? undefined : { describe, it }
}

function runner(): Runner | undefined {
  const describe = globalDescribe()
  return describe === undefined ? undefined : withIt(describe)
}

async function runAll(subject: Ignorer, files: readonly CaseFile[]): Promise<void> {
  const outcomes = await Promise.all(files.map((file) => outcomeOf(subject, file)))
  const failed = outcomes.filter((outcome) => outcome.passed === false)
  if (failed.length > 0) throw new Error(failed.map(messageFor).join('\n\n'))
}

function registerCase(run: Runner, subject: Ignorer, file: CaseFile): void {
  run.it(file.name, async () => {
    const outcome = await outcomeOf(subject, file)
    if (outcome.passed === false) throw new Error(messageFor(outcome))
  })
}

function registerAll(run: Runner, subject: Ignorer, files: readonly CaseFile[]): void {
  run.describe(subject.name, () => {
    for (const file of files) registerCase(run, subject, file)
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
  if (run === undefined) await runAll(subject, files)
  else registerAll(run, subject, files)
}
