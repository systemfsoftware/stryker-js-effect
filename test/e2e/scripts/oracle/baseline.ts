import type { ExecutionMutantStatus } from './types.js'

export type OracleSliceId = 'lifecycle' | 'edge' | 'checker' | 'resilience'

export type BaselineCountKey =
  | 'compileErrors'
  | 'ignored'
  | 'killed'
  | 'noCoverage'
  | 'pending'
  | 'runtimeErrors'
  | 'survived'
  | 'timeout'

export type BaselineCounts = Readonly<Record<BaselineCountKey, number>>

export interface BlessedBaseline {
  readonly artifactContract: 'stryker-oracle-baseline/v1'
  readonly slice: OracleSliceId
  readonly strykerConfig: string
  readonly counts: BaselineCounts
  readonly mutatorStatusTally: Readonly<Record<string, number>>
}

export const ARTIFACT_CONTRACT = 'stryker-oracle-baseline/v1' as const

export const BASELINE_COUNT_KEYS: ReadonlyArray<BaselineCountKey> = Object.freeze([
  'compileErrors',
  'ignored',
  'killed',
  'noCoverage',
  'pending',
  'runtimeErrors',
  'survived',
  'timeout',
])

export const ZERO_COUNTS: BaselineCounts = Object.freeze({
  compileErrors: 0,
  ignored: 0,
  killed: 0,
  noCoverage: 0,
  pending: 0,
  runtimeErrors: 0,
  survived: 0,
  timeout: 0,
}) as BaselineCounts

export const EXECUTION_STATUSES: ReadonlyArray<ExecutionMutantStatus> = Object.freeze([
  'Killed',
  'Survived',
  'NoCoverage',
  'Timeout',
  'RuntimeError',
])

export interface BaselineDiff {
  readonly countsDiff: Readonly<Partial<Record<BaselineCountKey, readonly [number, number]>>>
  readonly tallyDiff: Readonly<Partial<Record<string, readonly [number, number]>>>
  isEmpty(): boolean
}

export function tallyMutatorStatuses(
  pairs: ReadonlyArray<readonly [string, string]>,
): Readonly<Record<string, number>> {
  const tally: Record<string, number> = {}
  for (const [mutator, status] of pairs) {
    const key = `${mutator}:${status}`
    tally[key] = (tally[key] ?? 0) + 1
  }
  return tally
}

export function sortTally(tally: Readonly<Record<string, number>>): Readonly<Record<string, number>> {
  const sorted: Record<string, number> = {}
  for (const key of Object.keys(tally).sort()) {
    const count = tally[key] ?? 0
    if (count > 0) {
      sorted[key] = count
    }
  }
  return sorted
}

function cloneCounts(counts: BaselineCounts): Record<BaselineCountKey, number> {
  return {
    compileErrors: counts.compileErrors,
    ignored: counts.ignored,
    killed: counts.killed,
    noCoverage: counts.noCoverage,
    pending: counts.pending,
    runtimeErrors: counts.runtimeErrors,
    survived: counts.survived,
    timeout: counts.timeout,
  }
}

function validateSlice(value: unknown): OracleSliceId {
  if (value === 'lifecycle' || value === 'edge' || value === 'checker' || value === 'resilience') {
    return value
  }
  throw new Error(`Invalid baseline slice: ${JSON.stringify(value)}; expected one of lifecycle|edge|checker|resilience`)
}

function validateCounts(value: unknown): BaselineCounts {
  if (value === null || typeof value !== 'object') {
    throw new Error(`Invalid baseline counts: expected object, received ${typeof value}`)
  }
  const record = value as Record<string, unknown>
  const out: Record<BaselineCountKey, number> = { ...ZERO_COUNTS } as Record<BaselineCountKey, number>
  for (const key of BASELINE_COUNT_KEYS) {
    const raw = record[key]
    if (typeof raw !== 'number' || !Number.isFinite(raw)) {
      throw new Error(
        `Invalid baseline counts.${key}: expected non-negative finite number, received ${JSON.stringify(raw)}`,
      )
    }
    if (!Number.isInteger(raw) || raw < 0) {
      throw new Error(`Invalid baseline counts.${key}: expected non-negative integer, received ${raw}`)
    }
    out[key] = raw
  }
  return out as BaselineCounts
}

function validateTally(value: unknown): Readonly<Record<string, number>> {
  if (value === null || typeof value !== 'object') {
    throw new Error(`Invalid baseline mutatorStatusTally: expected object, received ${typeof value}`)
  }
  const record = value as Record<string, unknown>
  const out: Record<string, number> = {}
  for (const [key, raw] of Object.entries(record)) {
    if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 0) {
      throw new Error(
        `Invalid baseline mutatorStatusTally[${JSON.stringify(key)}]: expected non-negative integer, received ${
          JSON.stringify(raw)
        }`,
      )
    }
    if (raw > 0) {
      out[key] = raw
    }
  }
  return out
}

export function encodeBaseline(baseline: BlessedBaseline): string {
  const sortedTally = sortTally(baseline.mutatorStatusTally)
  const ordered = {
    artifactContract: ARTIFACT_CONTRACT,
    slice: baseline.slice,
    strykerConfig: baseline.strykerConfig,
    counts: cloneCounts(baseline.counts),
    mutatorStatusTally: sortedTally,
  }
  return `${JSON.stringify(ordered, undefined, 2)}\n`
}

export function decodeBaseline(text: string): BlessedBaseline {
  const parsed = JSON.parse(text) as unknown
  if (parsed === null || typeof parsed !== 'object') {
    throw new Error('Invalid baseline: expected JSON object at root')
  }
  const record = parsed as Record<string, unknown>
  if (record['artifactContract'] !== ARTIFACT_CONTRACT) {
    throw new Error(
      `Invalid baseline artifactContract: expected ${JSON.stringify(ARTIFACT_CONTRACT)}, received ${
        JSON.stringify(record['artifactContract'])
      }`,
    )
  }
  const strykerConfig = record['strykerConfig']
  if (typeof strykerConfig !== 'string') {
    throw new Error(`Invalid baseline strykerConfig: expected string, received ${typeof strykerConfig}`)
  }
  return {
    artifactContract: ARTIFACT_CONTRACT,
    slice: validateSlice(record['slice']),
    strykerConfig,
    counts: validateCounts(record['counts']),
    mutatorStatusTally: validateTally(record['mutatorStatusTally']),
  }
}

export function compareBaselines(a: BlessedBaseline, b: BlessedBaseline): BaselineDiff {
  const countsDiff: Record<string, [number, number]> = {}
  for (const key of BASELINE_COUNT_KEYS) {
    const av = a.counts[key]
    const bv = b.counts[key]
    if (av !== bv) {
      countsDiff[key] = [av, bv]
    }
  }
  const tallyDiff: Record<string, [number, number]> = {}
  const tallyKeys: Record<string, true> = {}
  for (const key of Object.keys(a.mutatorStatusTally)) {
    tallyKeys[key] = true
  }
  for (const key of Object.keys(b.mutatorStatusTally)) {
    tallyKeys[key] = true
  }
  for (const key of Object.keys(tallyKeys)) {
    const av = a.mutatorStatusTally[key] ?? 0
    const bv = b.mutatorStatusTally[key] ?? 0
    if (av !== bv) {
      tallyDiff[key] = [av, bv]
    }
  }
  const diff: BaselineDiff = {
    countsDiff,
    tallyDiff,
    isEmpty(): boolean {
      return Object.keys(this.countsDiff).length === 0 && Object.keys(this.tallyDiff).length === 0
    },
  }
  return diff
}

export function formatBaselineDiff(diff: BaselineDiff): string {
  if (diff.isEmpty()) {
    return 'baseline diff: <empty>'
  }
  const lines: string[] = ['baseline diff:']
  const countsKeys = Object.keys(diff.countsDiff).sort()
  if (countsKeys.length > 0) {
    lines.push('  counts:')
    for (const key of countsKeys) {
      const [av, bv] = (diff.countsDiff as Record<string, readonly [number, number]>)[key]!
      lines.push(`    ${key}: ${av} -> ${bv}`)
    }
  }
  const tallyKeys = Object.keys(diff.tallyDiff).sort()
  if (tallyKeys.length > 0) {
    lines.push('  mutatorStatusTally:')
    for (const key of tallyKeys) {
      const [av, bv] = (diff.tallyDiff as Record<string, readonly [number, number]>)[key]!
      lines.push(`    ${key}: ${av} -> ${bv}`)
    }
  }
  return lines.join('\n')
}
