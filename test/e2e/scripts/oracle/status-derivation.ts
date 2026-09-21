import type { IndependentInventory, IndependentMutant } from './types.js'

/**
 * Compile-error flagging layer: takes the raw diagnostic output of
 * `evaluateWithProjects` and groups it per mutator family. The keys are
 * the diagnostic codes (e.g. 2353) the ts-morph pre-emit diagnostics
 * surfaced for ACTIVE mutants; the values are the counts of mutants
 * whose first compile error carried that code.
 */
export interface CompileErrorFlags {
  readonly codesByMutator: Readonly<Record<string, readonly number[]>>
}

export interface StaticOracleSlice {
  readonly familyTally: Readonly<Record<string, number>>
  readonly placementTally: Readonly<Record<string, number>>
  readonly ignoredCount: number
  readonly compileErrorCount: number
  readonly compileErrorCodes: Readonly<Record<number, number>>
  readonly blockers: readonly string[]
}

/**
 * Pure status derivation: merges an inventory with per-mutant compile-error
 * flags to produce the static oracle portion for one slice. No fs, no
 * process, no I/O — all inputs are passed in.
 *
 * Rules enforced here:
 * - Per-family tallies include ONLY families with count > 0 (R-EMPTY).
 * - Ignored counts come from `inventory.ignoredCount` (the analyzer's own
 *   tally, which already includes excludedMutations and Stryker directives).
 * - CompileError counts carry per-code distribution; the first code on a
 *   mutant is recorded under its mutator family.
 * - `blockers` lists every mutant whose final status is execution-decided
 *   or not-yet-blessed. R6 — we NEVER invent statuses. The oracle's job
 *   is to name what it cannot decide, never to decide it.
 * - Zero-valid-mutant input → empty `familyTally` (NaN-score guard:
 *   downstream mutation-score math must not divide by zero). See
 *   docs/solutions/runtime-errors/host-instrumenter-namespace-identity.md
 *   INV-3 (empty mutation scores are NaN, not 0).
 */
export function deriveStaticOracleSlice(
  inventory: IndependentInventory,
  flags: CompileErrorFlags,
): StaticOracleSlice {
  const familyTally: Record<string, number> = {}
  const compileErrorCodes: Record<number, number> = {}
  const blockers: string[] = []
  let compileErrorCount = 0

  for (const m of inventory.mutants) {
    if (m.status === 'Ignored') {
      continue
    }
    const codes = flags.codesByMutator[m.mutatorName] ?? []
    if (m.compileError !== undefined) {
      const code = m.compileError.code
      compileErrorCodes[code] = (compileErrorCodes[code] ?? 0) + 1
      compileErrorCount += 1
      familyTally[m.mutatorName] = (familyTally[m.mutatorName] ?? 0) + 1
    } else if (codes.length === 0) {
      blockers.push(identifierOf(m))
    }
  }

  for (const [name, count] of Object.entries(familyTally)) {
    if (count <= 0) {
      delete familyTally[name]
    }
  }

  return {
    familyTally,
    placementTally: Object.fromEntries(
      Object.entries(inventory.mutatorTally).filter(([, count]) => count > 0),
    ),
    ignoredCount: inventory.ignoredCount,
    compileErrorCount,
    compileErrorCodes,
    blockers,
  }
}

function identifierOf(m: IndependentMutant): string {
  return `${m.mutatorName}@L${m.line}:${m.start}-${m.end}`
}
