import type { BaselineCounts } from '../../src/Oracle/baseline.schema.js'

export interface NormalizedCounts {
  readonly compileErrors: number
  readonly ignored: number
  readonly killedOrTimeout: number
  readonly noCoverage: number
  readonly pending: number
  readonly runtimeErrors: number
  readonly survived: number
}

export const SURVIVED_DRIFT_MARGIN = 2

export function normalizeCounts(counts: BaselineCounts): NormalizedCounts {
  return {
    compileErrors: counts.compileErrors,
    ignored: counts.ignored,
    killedOrTimeout: counts.killed + counts.timeout,
    noCoverage: counts.noCoverage,
    pending: counts.pending,
    runtimeErrors: counts.runtimeErrors,
    survived: counts.survived,
  }
}

export function foldTimeoutIntoKilled(counts: BaselineCounts): BaselineCounts {
  return { ...counts, killed: counts.killed + counts.timeout, timeout: 0 }
}

export function normalizeTally(tally: Readonly<Record<string, number>>): Readonly<Record<string, number>> {
  const folded: Record<string, number> = {}
  for (const key of Object.keys(tally).sort()) {
    const separator = key.lastIndexOf(':')
    const mutator = key.slice(0, separator)
    const status = key.slice(separator + 1)
    const foldedKey = status === 'Killed' || status === 'Timeout' ? `${mutator}:KilledOrTimeout` : key
    folded[foldedKey] = (folded[foldedKey] ?? 0) + tally[key]!
  }
  return folded
}

export function survivedFloor(counts: BaselineCounts): number {
  return Math.max(0, counts.survived - SURVIVED_DRIFT_MARGIN)
}

const CLOCK_STATUS_SUFFIX = [':Killed', ':Survived', ':Timeout', ':KilledOrTimeout']

export function withoutClockStatuses(
  tally: Readonly<Record<string, number>>,
): Readonly<Record<string, number>> {
  const kept: Record<string, number> = {}
  for (const [key, count] of Object.entries(tally)) {
    if (CLOCK_STATUS_SUFFIX.some((suffix) => key.endsWith(suffix))) {
      continue
    }
    kept[key] = count
  }
  return kept
}

export function normalizedTotal(counts: NormalizedCounts): number {
  return (
    counts.compileErrors +
    counts.ignored +
    counts.killedOrTimeout +
    counts.noCoverage +
    counts.pending +
    counts.runtimeErrors +
    counts.survived
  )
}
