import * as fs from 'node:fs'
import * as path from 'node:path'
import { analyzeFileWithTsMorph } from './oracle/ast-analyzer.js'
import type { IndependentInventory, IndependentMutant } from './oracle/types.js'
import { runCli } from './reconcile-oracle.js'

export { analyzeFileWithTsMorph, DIRECTIVE_REGEX } from './oracle/ast-analyzer.js'
export { determineCompileErrorsWithDiagnostics } from './oracle/diagnostics.js'
export type { DirectiveRule, IndependentInventory, IndependentMutant } from './oracle/types.js'

const usage = 'usage: pnpm derive-oracle --reconcile [slice ...] | pnpm derive-oracle --check [slice ...]'

if (process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2)
  if (args.length === 0 || args.some((a) => a === '--help')) {
    process.stdout.write(`${usage}\n`)
    process.exit(args.some((a) => a === '--help') ? 0 : 1)
  }
  const result = runCli(args)
  process.exit(result.exitCode)
}

export function deriveIndependentOracle(options: {
  readonly fixtureDir: string
  readonly mutateFiles: readonly string[]
  readonly excludedMutations?: readonly string[]
}): IndependentInventory {
  const { fixtureDir, mutateFiles, excludedMutations = [] } = options
  const allMutants: IndependentMutant[] = []
  const combinedTally: Record<string, number> = {}
  let totalActive = 0
  let totalIgnored = 0

  for (const rel of mutateFiles) {
    const fullPath = path.resolve(fixtureDir, rel)
    const content = fs.readFileSync(fullPath, 'utf8')
    const res = analyzeFileWithTsMorph(content, excludedMutations)

    for (const m of res.mutants) {
      allMutants.push(m)
    }
    for (const [k, v] of Object.entries(res.mutatorTally)) {
      combinedTally[k] = (combinedTally[k] || 0) + v
    }
    totalActive += res.activeCount
    totalIgnored += res.ignoredCount
  }

  return {
    mutants: allMutants,
    mutatorTally: combinedTally,
    activeCount: totalActive,
    ignoredCount: totalIgnored,
  }
}
