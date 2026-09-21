import * as fs from 'node:fs'
import * as path from 'node:path'
import { analyzeFileWithTsMorph } from './oracle/ast-analyzer.js'
import { type BaselineCountKey, type BlessedBaseline, decodeBaseline, type OracleSliceId } from './oracle/baseline.js'
import { determineCompileErrorsWithDiagnostics } from './oracle/diagnostics.js'
import { listRegisteredSlices, ORACLE_SLICES, type OracleSliceConfig } from './oracle/slice-config.js'
import { type CompileErrorFlags, deriveStaticOracleSlice, type StaticOracleSlice } from './oracle/status-derivation.js'
import type { IndependentInventory, IndependentMutant } from './oracle/types.js'

export type { BaselineCountKey, BlessedBaseline, OracleSliceId } from './oracle/baseline.js'

export type CountKey = BaselineCountKey

export type StaticStatusKey = 'CompileError' | 'Ignored'

export type ExecutionStatusKey = 'Killed' | 'Survived' | 'NoCoverage' | 'Timeout' | 'RuntimeError'

const STATIC_STATUSES: ReadonlySet<string> = new Set(['CompileError', 'Ignored'])
const EXECUTION_STATUSES: ReadonlySet<string> = new Set(['Killed', 'Survived', 'NoCoverage', 'Timeout', 'RuntimeError'])

export type DriftFinding =
  | {
    readonly kind: 'count'
    readonly slice: OracleSliceId
    readonly key: CountKey
    readonly baseline: number
    readonly recomputed: number
  }
  | {
    readonly kind: 'tally'
    readonly slice: OracleSliceId
    readonly family: string
    readonly status: StaticStatusKey
    readonly baseline: number
    readonly recomputed: number
  }
  | {
    readonly kind: 'tally-missing'
    readonly slice: OracleSliceId
    readonly family: string
    readonly status: StaticStatusKey
    readonly recomputed: number
  }
  | { readonly kind: 'unblessed'; readonly slice: OracleSliceId }
  | {
    readonly kind: 'needs-rebless'
    readonly slice: OracleSliceId
    readonly family: string
    readonly status: ExecutionStatusKey
    readonly tallyBaseline: number
  }

export interface SliceReconciliationReport {
  readonly slice: OracleSliceId
  readonly baseline: BlessedBaseline | undefined
  readonly staticSlice: StaticOracleSlice
  readonly findings: readonly DriftFinding[]
  readonly staticMatched: boolean
}

export function splitStaticAndExecutionTally(
  tally: Readonly<Record<string, number>>,
): { readonly staticRows: Readonly<Record<string, number>>; readonly executionRows: Readonly<Record<string, number>> } {
  const staticRows: Record<string, number> = {}
  const executionRows: Record<string, number> = {}
  for (const [key, value] of Object.entries(tally)) {
    const colon = key.lastIndexOf(':')
    const status = colon >= 0 ? key.slice(colon + 1) : ''
    if (STATIC_STATUSES.has(status)) {
      staticRows[key] = value
    } else {
      executionRows[key] = value
    }
  }
  return { staticRows, executionRows }
}

export function reconcileSlice(
  sliceId: OracleSliceId,
  baseline: BlessedBaseline | undefined,
  staticSlice: StaticOracleSlice,
): SliceReconciliationReport {
  if (baseline === undefined) {
    return {
      slice: sliceId,
      baseline,
      staticSlice,
      findings: [{ kind: 'unblessed', slice: sliceId }],
      staticMatched: false,
    }
  }

  const findings: DriftFinding[] = []
  const driftedFamilies = new Set<string>()

  if (baseline.counts.compileErrors !== staticSlice.compileErrorCount) {
    findings.push({
      kind: 'count',
      slice: sliceId,
      key: 'compileErrors',
      baseline: baseline.counts.compileErrors,
      recomputed: staticSlice.compileErrorCount,
    })
  }
  if (baseline.counts.ignored !== staticSlice.ignoredCount) {
    findings.push({
      kind: 'count',
      slice: sliceId,
      key: 'ignored',
      baseline: baseline.counts.ignored,
      recomputed: staticSlice.ignoredCount,
    })
  }

  const { staticRows: baselineStaticRows } = splitStaticAndExecutionTally(baseline.mutatorStatusTally)

  for (const [rowKey, baselineCount] of Object.entries(baselineStaticRows)) {
    const colon = rowKey.lastIndexOf(':')
    const family = rowKey.slice(0, colon)
    const status = rowKey.slice(colon + 1) as StaticStatusKey
    const recomputed = status === 'CompileError' ? (staticSlice.familyTally[family] ?? 0) : 0
    if (recomputed !== baselineCount) {
      findings.push({
        kind: 'tally',
        slice: sliceId,
        family,
        status,
        baseline: baselineCount,
        recomputed,
      })
      driftedFamilies.add(family)
    }
  }

  for (const [family, recomputed] of Object.entries(staticSlice.familyTally)) {
    if (recomputed <= 0) continue
    const rowKey = `${family}:CompileError`
    if (baselineStaticRows[rowKey] !== undefined) continue
    findings.push({
      kind: 'tally-missing',
      slice: sliceId,
      family,
      status: 'CompileError',
      recomputed,
    })
    driftedFamilies.add(family)
  }

  const { executionRows } = splitStaticAndExecutionTally(baseline.mutatorStatusTally)
  for (const [rowKey, tallyBaseline] of Object.entries(executionRows)) {
    const colon = rowKey.lastIndexOf(':')
    const family = rowKey.slice(0, colon)
    const status = rowKey.slice(colon + 1)
    if (!EXECUTION_STATUSES.has(status)) continue
    if (!driftedFamilies.has(family)) continue
    findings.push({
      kind: 'needs-rebless',
      slice: sliceId,
      family,
      status: status as ExecutionStatusKey,
      tallyBaseline,
    })
  }

  const staticMatched = !findings.some((f) =>
    f.kind === 'count' || f.kind === 'tally' || f.kind === 'tally-missing' || f.kind === 'unblessed'
  )

  return { slice: sliceId, baseline, staticSlice, findings, staticMatched }
}

export function formatDriftLine(finding: DriftFinding): string {
  switch (finding.kind) {
    case 'count':
      return `ORACLE-DRIFT ${finding.slice} count:${finding.key} ${finding.baseline} -> ${finding.recomputed}`
    case 'tally':
      return `ORACLE-DRIFT ${finding.slice} ${finding.family}:${finding.status} ${finding.baseline} -> ${finding.recomputed}`
    case 'tally-missing':
      return `ORACLE-DRIFT ${finding.slice} ${finding.family}:${finding.status} missing-in-baseline recomputed=${finding.recomputed}`
    case 'unblessed':
      return `ORACLE-DRIFT ${finding.slice} unblessed`
    case 'needs-rebless':
      return `ORACLE-DRIFT ${finding.slice} ${finding.family}:${finding.status} needs-rebless baseline=${finding.tallyBaseline}`
  }
}

function expandMutateGlob(fixtureDir: string, pattern: string): readonly string[] {
  if (pattern.startsWith('!')) return []
  const matches = fs.globSync(pattern, { cwd: fixtureDir })
  return matches.map((m) => path.relative(fixtureDir, m).split(path.sep).join('/'))
}

function globToRegExp(glob: string): RegExp {
  let regex = ''
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i] ?? ''
    if (c === '*') regex += '[^/]*'
    else if (c === '?') regex += '[^/]'
    else if ('\\^$.|+(){}[]'.includes(c)) regex += '\\' + c
    else regex += c
  }
  return new RegExp('^' + regex + '$')
}

export function expandSliceMutateFiles(slice: OracleSliceConfig): readonly string[] {
  const positives: string[] = []
  const negatives: string[] = []
  for (const pattern of slice.mutateFiles) {
    if (pattern.startsWith('!')) negatives.push(pattern.slice(1))
    else positives.push(...expandMutateGlob(slice.fixtureDir, pattern))
  }
  const excludeRe = negatives.map((n) => globToRegExp(n))
  const filtered = positives.filter((p) => !excludeRe.some((re) => re.test(p)))
  return Array.from(new Set(filtered)).sort()
}

interface FileInventoryResult {
  readonly inventory: IndependentInventory
  readonly flags: CompileErrorFlags
}

function inventoryForFile(
  fixtureDir: string,
  relPath: string,
  excludedMutations: readonly string[],
): FileInventoryResult {
  const absPath = path.resolve(fixtureDir, relPath)
  const sourceText = fs.readFileSync(absPath, 'utf8')
  const inventory = analyzeFileWithTsMorph(sourceText, excludedMutations)
  const activeMutants = inventory.mutants.filter((m): m is IndependentMutant => m.status === 'Active')
  const diagnosed = determineCompileErrorsWithDiagnostics(sourceText, activeMutants)
  const codesByMutator: Record<string, number[]> = {}
  for (const m of diagnosed) {
    if (m.compileError === undefined) continue
    const list = codesByMutator[m.mutatorName] ?? []
    list.push(m.compileError.code)
    codesByMutator[m.mutatorName] = list
  }
  return { inventory, flags: { codesByMutator } }
}

export function recomputeStaticSlice(slice: OracleSliceConfig): StaticOracleSlice {
  const files = expandSliceMutateFiles(slice)
  const allMutants: IndependentMutant[] = []
  const allCodesByMutator: Record<string, number[]> = {}
  let totalIgnored = 0

  for (const rel of files) {
    const { inventory, flags } = inventoryForFile(slice.fixtureDir, rel, slice.excludedMutations)
    for (const m of inventory.mutants) {
      allMutants.push(m)
    }
    totalIgnored += inventory.ignoredCount
    for (const [family, codes] of Object.entries(flags.codesByMutator)) {
      const list = allCodesByMutator[family] ?? []
      list.push(...codes)
      allCodesByMutator[family] = list
    }
  }

  const tally: Record<string, number> = {}
  for (const m of allMutants) {
    tally[m.mutatorName] = (tally[m.mutatorName] ?? 0) + 1
  }
  const allInventory: IndependentInventory = {
    mutants: allMutants,
    mutatorTally: tally,
    activeCount: allMutants.filter((m) => m.status === 'Active').length,
    ignoredCount: totalIgnored,
  }

  return deriveStaticOracleSlice(allInventory, { codesByMutator: allCodesByMutator })
}

const BASELINES_DIR = path.resolve('test/e2e/oracle-baselines')

export function loadBaseline(slice: OracleSliceId): BlessedBaseline | undefined {
  const filePath = path.join(BASELINES_DIR, `${slice}.json`)
  if (!fs.existsSync(filePath)) return undefined
  const text = fs.readFileSync(filePath, 'utf8')
  return decodeBaseline(text)
}

export interface CliOptions {
  readonly check: boolean
  readonly sliceIds: readonly OracleSliceId[]
}

export function parseCliArgs(argv: readonly string[]): CliOptions {
  let check = false
  const sliceIds: OracleSliceId[] = []
  for (const arg of argv) {
    if (arg === '--check') {
      check = true
    } else if (arg.startsWith('--')) {
      throw new Error(`Unknown flag: ${arg}`)
    } else {
      sliceIds.push(arg as OracleSliceId)
    }
  }
  return { check, sliceIds }
}

export interface CliRunResult {
  readonly exitCode: 0 | 1
  readonly reports: readonly SliceReconciliationReport[]
}

export function runCli(argv: readonly string[]): CliRunResult {
  const opts = parseCliArgs(argv)
  const slices = opts.sliceIds.length === 0 ? listRegisteredSlices() : opts.sliceIds.map((id) => ORACLE_SLICES[id])
  const reports: SliceReconciliationReport[] = []
  for (const slice of slices) {
    const baseline = loadBaseline(slice.id)
    const staticSlice = recomputeStaticSlice(slice)
    const report = reconcileSlice(slice.id, baseline, staticSlice)
    reports.push(report)
    printReport(report)
  }
  const drift = reports.some((r) => r.findings.length > 0)
  const exitCode: 0 | 1 = opts.check && drift ? 1 : 0
  return { exitCode, reports }
}

function printReport(report: SliceReconciliationReport): void {
  process.stdout.write(`slice: ${report.slice}\n`)
  process.stdout.write(`  staticMatched: ${report.staticMatched}\n`)
  process.stdout.write(
    `  compileErrors (baseline/recomputed): ${
      report.baseline?.counts.compileErrors ?? '—'
    } / ${report.staticSlice.compileErrorCount}\n`,
  )
  process.stdout.write(
    `  ignored       (baseline/recomputed): ${
      report.baseline?.counts.ignored ?? '—'
    } / ${report.staticSlice.ignoredCount}\n`,
  )
  if (report.findings.length === 0) {
    process.stdout.write(`  findings: none\n`)
    return
  }
  process.stdout.write(`  findings:\n`)
  for (const finding of report.findings) {
    process.stdout.write(`    ${formatDriftLine(finding)}\n`)
  }
}

function isMainModule(): boolean {
  const entry = process.argv[1]
  if (entry === undefined) return false
  return import.meta.url === `file://${entry}`
}

if (isMainModule()) {
  const result = runCli(process.argv.slice(2))
  process.exit(result.exitCode)
}
