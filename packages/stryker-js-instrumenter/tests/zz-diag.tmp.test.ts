import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import * as oxc from 'oxc-parser'
import { printProgram } from '../src/print/index.js'
import { printProgram as legacyPrintProgram } from '../src/print/legacy.tmp.js'
import { expect, it } from 'vitest'

const ROOT = '/home/ryan/Documents/projects/systemfsoftware/stryker-js-effect.worktrees/systemf-updates'
const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs']
const LANG_BY_EXTENSION: Record<string, 'js' | 'ts' | 'tsx'> = {
  '.ts': 'ts',
  '.mts': 'ts',
  '.cts': 'ts',
  '.tsx': 'tsx',
  '.js': 'js',
  '.jsx': 'js',
  '.mjs': 'js',
  '.cjs': 'js',
}
const SKIP_DIRS: Record<string, true> = { node_modules: true, dist: true, '.turbo': true, temp: true, coverage: true, '.git': true }

const walk = (dir: string): string[] => {
  const out: string[] = []
  const visit = (current: string): void => {
    for (const entry of readdirSync(current).sort()) {
      if (SKIP_DIRS[entry] === true) continue
      const full = join(current, entry)
      if (statSync(full).isDirectory()) visit(full)
      else if (SOURCE_EXTENSIONS.some((ext) => entry.endsWith(ext))) out.push(full)
    }
  }
  visit(dir)
  return out
}

const isPrinterSource = (path: string): boolean =>
  /stryker-js-instrumenter[\\/]src[\\/](print[\\/]|Printer\.ts$)/.test(path)

it('prints every current corpus input identically through both printers', () => {
  const files = [
    ...walk(join(ROOT, 'test/e2e/testResources')),
    ...walk(join(ROOT, 'packages/stryker-js-instrumenter/src')),
    ...walk(join(ROOT, 'packages/stryker-js/src')),
  ].filter((file) => isPrinterSource(file) === false)

  const mismatches: string[] = []
  for (const file of files) {
    const extension = file.slice(file.lastIndexOf('.'))
    const lang = LANG_BY_EXTENSION[extension]
    if (lang === undefined) continue
    const source = readFileSync(file, 'utf8')
    const parsed = oxc.parseSync(file, source, { lang, range: true })
    const printed = printProgram(parsed.program, { comments: parsed.comments, hashbang: null })
    const legacy = legacyPrintProgram(parsed.program, { comments: parsed.comments, hashbang: null })
    if (printed !== legacy) {
      mismatches.push(`${relative(ROOT, file)} (len ${printed.length} vs ${legacy.length})`)
      if (mismatches.length <= 3) {
        for (let offset = 0; offset < Math.max(printed.length, legacy.length); offset++) {
          if (printed[offset] !== legacy[offset]) {
            console.log(`first divergence in ${relative(ROOT, file)} at ${offset}: new=${JSON.stringify(printed.slice(Math.max(0, offset - 60), offset + 60))} legacy=${JSON.stringify(legacy.slice(Math.max(0, offset - 60), offset + 60))}`)
            break
          }
        }
      }
    }
  }
  expect(mismatches, `${mismatches.length} of ${files.length} files diverge`).toEqual([])
})
