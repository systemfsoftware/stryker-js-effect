import { describe } from '@systemfsoftware/vitest'

import type { BaselineCounts } from '../../src/Oracle/baseline.schema.js'
import { normalizeCounts, normalizedTotal, normalizeTally, survivedFloor } from './normalize.js'

const counts = (overrides: Partial<BaselineCounts>): BaselineCounts => ({
  compileErrors: 0,
  ignored: 0,
  killed: 0,
  noCoverage: 0,
  pending: 0,
  runtimeErrors: 0,
  survived: 0,
  timeout: 0,
  ...overrides,
})

describe('normalizeCounts', (it) => {
  it('folds killed and timeout into killedOrTimeout', function*({ expect }) {
    yield* expect(normalizeCounts(counts({ killed: 97, timeout: 109 })).killedOrTimeout).toBe(206)
  })

  it('preserves every load-stable dimension verbatim', function*({ expect }) {
    const normalized = normalizeCounts(
      counts({ compileErrors: 3, ignored: 4, noCoverage: 2, pending: 0, runtimeErrors: 1, survived: 16 }),
    )
    yield* expect(normalized).toMatchObject({
      compileErrors: 3,
      ignored: 4,
      noCoverage: 2,
      runtimeErrors: 1,
      survived: 16,
    })
  })

  it('preserves the grand total through folding', function*({ expect }) {
    const raw = counts({ killed: 72, timeout: 136, survived: 16, compileErrors: 8, ignored: 4, noCoverage: 6 })
    const rawTotal = raw.killed + raw.timeout + raw.survived + raw.compileErrors + raw.ignored + raw.noCoverage
    yield* expect(normalizedTotal(normalizeCounts(raw))).toBe(rawTotal)
  })
})

describe('normalizeTally', (it) => {
  it('folds per-mutator Killed and Timeout entries', function*({ expect }) {
    yield* expect(
      normalizeTally({
        'ArithmeticOperator:Killed': 2,
        'ArithmeticOperator:Timeout': 1,
        'ArithmeticOperator:Survived': 3,
      }),
    ).toEqual({
      'ArithmeticOperator:KilledOrTimeout': 3,
      'ArithmeticOperator:Survived': 3,
    })
  })

  it('keeps mutators with a single execution status untouched', function*({ expect }) {
    yield* expect(normalizeTally({ 'BlockStatement:Killed': 1 })).toEqual({ 'BlockStatement:KilledOrTimeout': 1 })
  })

  it('emits keys in sorted order', function*({ expect }) {
    yield* expect(Object.keys(normalizeTally({ 'B:Killed': 1, 'A:Survived': 1 }))).toEqual([
      'A:Survived',
      'B:KilledOrTimeout',
    ])
  })
})

describe('survivedFloor', (it) => {
  it('subtracts the documented drift margin', function*({ expect }) {
    yield* expect(survivedFloor(counts({ survived: 16 }))).toBe(14)
  })

  it('never goes below zero', function*({ expect }) {
    yield* expect(survivedFloor(counts({ survived: 1 }))).toBe(0)
  })
})
