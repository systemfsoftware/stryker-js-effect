import { describe } from '@systemfsoftware/vitest'
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

describe('renderLiteralBlock', (it) => {
  it('renders markers around sorted, canonically-keyed constants', function*({ expect }) {
    const block = renderLiteralBlock(literals)
    const lines = block.split('\n')
    const tallyStart = block.indexOf('const EDGE_MUTATOR_TALLY')
    const tallyBody = block.slice(tallyStart, block.indexOf('}', tallyStart))
    const keys = [...tallyBody.matchAll(/'([^']+)':/g)].map((m) => m[1])

    yield* expect({ block, first: lines[0], last: lines.at(-1), keys, sortedKeys: [...keys].sort() }).toSatisfy(
      (rendered) =>
        rendered.first === BLOCK_BEGIN &&
        rendered.last === BLOCK_END &&
        rendered.block.includes('const EDGE_COUNTS: {') &&
        rendered.block.includes('readonly compileErrors: number') &&
        rendered.block.includes('const EDGE_MUTATOR_TALLY: Readonly<Record<string, number>> = {') &&
        rendered.block.includes('compileErrors: 5,') &&
        rendered.keys.join(',') === rendered.sortedKeys.join(','),
      'the block is marked, wrapped in sorted canonical constants, and carries the rendered counts',
    )
  })

  it('omits the tally constant when the baseline tally is empty', function*({ expect }) {
    const block = renderLiteralBlock({ ...literals, mutatorStatusTally: {} })
    yield* expect(block).not.toContain('_MUTATOR_TALLY')
  })
})

describe('spliceLiteralBlock', (it) => {
  it('replaces the region between markers and preserves surrounding bytes', function*({ expect }) {
    const head = `import { test } from './harness.js'\n\n${BLOCK_BEGIN}`
    const tail = `\n\nconst EDGE_TOTAL = 11\n`
    const before = `${head}${renderLiteralBlock(literals)}${tail}`
    const nextLiterals = { ...literals, counts: { ...literals.counts, killedOrTimeout: 3 } }
    const after = spliceLiteralBlock(before, renderLiteralBlock(nextLiterals))

    yield* expect({ after, extracted: extractLiteralBlock(after) }).toSatisfy(
      (spliced) =>
        spliced.after.includes('killedOrTimeout: 3,') &&
        spliced.after.startsWith(head) &&
        spliced.after.endsWith(tail) &&
        spliced.extracted === renderLiteralBlock(nextLiterals),
      'the marked region holds the next render and the bytes around it are untouched',
    )
  })

  it('round-trips a spliced block to a zero diff on the next render', function*({ expect }) {
    let text = `head\n${renderLiteralBlock(literals)}\ntail\n`
    text = spliceLiteralBlock(text, renderLiteralBlock(literals))
    yield* expect(text).toBe(`head\n${renderLiteralBlock(literals)}\ntail\n`)
  })

  it('refuses to splice when the markers are absent', function*({ expect }) {
    yield* expect(() => spliceLiteralBlock('const x = 1\n', renderLiteralBlock(literals))).toThrow(/ORACLE-LITERALS/)
  })

  it('rejects a file with a BEGIN marker but no END marker', function*({ expect }) {
    const text = `${BLOCK_BEGIN}\nconst EDGE_COUNTS = {}\n`
    yield* expect(() => spliceLiteralBlock(text, renderLiteralBlock(literals))).toThrow(/ORACLE-LITERALS/)
  })
})
