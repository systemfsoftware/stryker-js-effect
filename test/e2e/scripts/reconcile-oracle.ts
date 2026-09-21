import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { analyzeFileWithTsMorph } from './oracle/ast-analyzer.js'
import { type BaselineCountKey, type BlessedBaseline, decodeBaseline, type OracleSliceId } from './oracle/baseline.js'
import { createPackageProjects, evaluateWithProjects } from './oracle/diagnostics.js'
import { listRegisteredSlices, ORACLE_SLICES, type OracleSliceConfig } from './oracle/slice-config.js'
import { type CompileErrorFlags, deriveStaticOracleSlice, type StaticOracleSlice } from './oracle/status-derivation.js'
import type { IndependentInventory, IndependentMutant } from './oracle/types.js'

export type { BaselineCountKey, BlessedBaseline, OracleSliceId } from './oracle/baseline.js'

export type CountKey = BaselineCountKey

export type DriftFinding =
  | {
    readonly kind: 'count'
    readonly slice: OracleSliceId
    readonly key: CountKey
    readonly baseline: number
    readonly recomputed: number
  }
  | { readonly kind: 'unblessed'; readonly slice: OracleSliceId }

export interface SliceReconciliationReport {
  readonly slice: OracleSliceId
  readonly baseline: BlessedBaseline | undefined
  readonly staticSlice: StaticOracleSlice
  readonly findings: readonly DriftFinding[]
  readonly staticMatched: boolean
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

  if (baseline.counts.ignored !== staticSlice.ignoredCount) {
    findings.push({
      kind: 'count',
      slice: sliceId,
      key: 'ignored',
      baseline: baseline.counts.ignored,
      recomputed: staticSlice.ignoredCount,
    })
  }

  const staticMatched = findings.length === 0

  return { slice: sliceId, baseline, staticSlice, findings, staticMatched }
}

export function formatDriftLine(finding: DriftFinding): string {
  switch (finding.kind) {
    case 'count':
      return `ORACLE-DRIFT ${finding.slice} count:${finding.key} ${finding.baseline} -> ${finding.recomputed}`
    case 'unblessed':
      return `ORACLE-DRIFT ${finding.slice} unblessed`
  }
}

function expandMutateGlob(fixtureDir: string, pattern: string): readonly string[] {
  if (pattern.startsWith('!')) return []
  const matches = fs.globSync(pattern, { cwd: fixtureDir })
  return matches
    .map((m) => (path.isAbsolute(m) ? m : path.resolve(fixtureDir, m)))
    .map((m) => path.relative(fixtureDir, m).split(path.sep).join('/'))
}

function globToRegExp(glob: string): RegExp {
  let regex = ''
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i] ?? ''
    if (c === '*') {
      if (glob[i + 1] === '*') {
        if (glob[i + 2] === '/') {
          regex += '(?:.*/)?'
          i += 2
        } else {
          regex += '.*'
          i += 1
        }
      } else {
        regex += '[^/]*'
      }
    } else if (c === '?') regex += '[^/]'
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
  projects: readonly PackageProject[],
  fixtureDir: string,
  relPath: string,
  excludedMutations: readonly string[],
): FileInventoryResult {
  const absPath = path.resolve(fixtureDir, relPath)
  const sourceText = fs.readFileSync(absPath, 'utf8')
  const inventory = analyzeFileWithTsMorph(sourceText, excludedMutations)
  const activeMutants = inventory.mutants.filter((m): m is IndependentMutant => m.status === 'Active')
  const diagnosed = evaluateWithProjects(projects, absPath, sourceText, activeMutants)
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
  const projects = createPackageProjects(slice.fixtureDir, slice.packageGlobs)
  const allMutants: IndependentMutant[] = []
  const allCodesByMutator: Record<string, number[]> = {}
  let totalIgnored = 0

  for (const rel of files) {
    const { inventory, flags } = inventoryForFile(projects, slice.fixtureDir, rel, slice.excludedMutations)
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

  const sliceStatic = deriveStaticOracleSlice(allInventory, { codesByMutator: allCodesByMutator })
  const excludedFamilies = new Set(slice.excludedMutations.map((name) => name.toLowerCase()))
  const configIgnoredCount = allInventory.mutants.filter(
    (m) => m.status === 'Ignored' && excludedFamilies.has(m.mutatorName.toLowerCase()),
  ).length

  return { ...sliceStatic, ignoredCount: configIgnoredCount }
}

const BASELINES_DIR = fileURLToPath(new URL('../oracle-baselines', import.meta.url))

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
  for (const id of opts.sliceIds) {
    if (!(id in ORACLE_SLICES)) {
      throw new Error(`Unknown slice "${id}". Valid slices: ${Object.keys(ORACLE_SLICES).join(', ')}`)
    }
  }
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
