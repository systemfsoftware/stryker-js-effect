import * as oxc from 'oxc-parser'
import { printProgram } from '../src/print/index.js'
import { printProgram as legacyPrintProgram } from '../src/print/legacy.tmp.js'
import { expect, it } from 'vitest'

const cases: readonly string[] = ['', '\n', 'export const add = (a: number, b: number) => a + b\n']

it('prints both ways for diagnosis', () => {
  for (const [index, source] of cases.entries()) {
    const parsed = oxc.parseSync('law.ts', source, { lang: 'ts', range: true })
    const printed = printProgram(parsed.program, { comments: parsed.comments, hashbang: null })
    const legacy = legacyPrintProgram(parsed.program, { comments: parsed.comments, hashbang: null })
    console.log(`case ${index} source=${JSON.stringify(source)}`)
    console.log(`  new=${JSON.stringify(printed)}`)
    console.log(`legacy=${JSON.stringify(legacy)}`)
    expect(printed, `case ${index} must match legacy`).toBe(legacy)
  }
})
