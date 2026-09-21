import { describe, expect, it } from 'vitest'
import { BLOCK_BEGIN, BLOCK_END, extractLiteralBlock, renderLiteralBlock, spliceLiteralBlock } from './literal-block.js'

const literals = {
  prefix: 'EDGE',
  counts: {
    compileErrors: 5,
    ignored: 4,
    killedOrTimeout: 2,
    noCoverage: 0,
    pending: 0,
    runtimeErrors: 0,
    survived: 0,
  },
  mutatorStatusTally: {
    'EqualityOperator:Ignored': 2,
    'ArithmeticOperator:KilledOrTimeout': 1,
    'ConditionalExpression:Ignored': 2,
  },
}

describe('renderLiteralBlock', () => {
  it('renders markers around sorted, canonically-keyed constants', () => {
    const block = renderLiteralBlock(literals)
    const lines = block.split('\n')
    expect(lines[0]).toBe(BLOCK_BEGIN)
    expect(lines.at(-1)).toBe(BLOCK_END)
    expect(block).toContain('const EDGE_COUNTS: {')
    expect(block).toContain('readonly compileErrors: number')
    expect(block).toContain('const EDGE_MUTATOR_TALLY: Readonly<Record<string, number>> = {')
    const tallyStart = block.indexOf('const EDGE_MUTATOR_TALLY')
    const tallyBody = block.slice(tallyStart, block.indexOf('}', tallyStart))
    const keys = [...tallyBody.matchAll(/'([^']+)':/g)].map((m) => m[1])
    expect(keys).toEqual([...keys].sort())
    expect(block).toContain('compileErrors: 5,')
  })

  it('omits the tally constant when the baseline tally is empty', () => {
    const block = renderLiteralBlock({ ...literals, mutatorStatusTally: {} })
    expect(block).not.toContain('_MUTATOR_TALLY')
  })
})

describe('spliceLiteralBlock', () => {
  it('replaces the region between markers and preserves surrounding bytes', () => {
    const before = `import { test } from './harness.js'\n\n${renderLiteralBlock(literals)}\n\nconst EDGE_TOTAL = 11\n`
    const nextLiterals = { ...literals, counts: { ...literals.counts, killedOrTimeout: 3 } }
    const after = spliceLiteralBlock(before, renderLiteralBlock(nextLiterals))
    expect(after).toContain('killedOrTimeout: 3,')
    expect(after.startsWith(`import { test } from './harness.js'\n\n${BLOCK_BEGIN}`)).toBe(true)
    expect(after.endsWith(`\n\nconst EDGE_TOTAL = 11\n`)).toBe(true)
    expect(extractLiteralBlock(after)).toBe(renderLiteralBlock(nextLiterals))
  })

  it('round-trips a spliced block to a zero diff on the next render', () => {
    let text = `head\n${renderLiteralBlock(literals)}\ntail\n`
    text = spliceLiteralBlock(text, renderLiteralBlock(literals))
    expect(text).toBe(`head\n${renderLiteralBlock(literals)}\ntail\n`)
  })

  it('refuses to splice when the markers are absent', () => {
    expect(() => spliceLiteralBlock('const x = 1\n', renderLiteralBlock(literals))).toThrow(/ORACLE-LITERALS/)
  })

  it('rejects a file with a BEGIN marker but no END marker', () => {
    const text = `${BLOCK_BEGIN}\nconst EDGE_COUNTS = {}\n`
    expect(() => spliceLiteralBlock(text, renderLiteralBlock(literals))).toThrow(/ORACLE-LITERALS/)
  })
})
