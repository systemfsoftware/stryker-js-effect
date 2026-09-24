import { describe, expect, it } from 'vitest'
import { type BlessedBaseline, formatDriftLine, reconcileSlice } from './reconcile-oracle.js'

function makeBaseline(overrides: Partial<BlessedBaseline> = {}): BlessedBaseline {
  return {
    artifactContract: 'stryker-oracle-baseline/v1',
    slice: 'lifecycle',
    strykerConfig: 'stryker.config.ts',
    counts: {
      compileErrors: 0,
      ignored: 0,
      killed: 0,
      noCoverage: 0,
      pending: 0,
      runtimeErrors: 0,
      survived: 0,
      timeout: 0,
    },
    mutatorStatusTally: {},
    ...overrides,
  }
}

function makeStaticSlice(overrides: Partial<{
  familyTally: Readonly<Record<string, number>>
  placementTally: Readonly<Record<string, number>>
  ignoredCount: number
  compileErrorCount: number
  compileErrorCodes: Readonly<Record<number, number>>
}> = {}) {
  return {
    familyTally: {},
    placementTally: {},
    ignoredCount: 0,
    compileErrorCount: 0,
    compileErrorCodes: {},
    blockers: [],
    ...overrides,
  }
}

describe('reconcileSlice — happy path', () => {
  it('reports zero findings when baseline matches recomputation', () => {
    const baseline = makeBaseline({
      counts: {
        compileErrors: 3,
        ignored: 1,
        killed: 0,
        noCoverage: 0,
        pending: 0,
        runtimeErrors: 0,
        survived: 0,
        timeout: 0,
      },
      mutatorStatusTally: {
        'BlockStatement:CompileError': 3,
      },
    })
    const staticSlice = makeStaticSlice({
      familyTally: { BlockStatement: 3 },
      ignoredCount: 1,
      compileErrorCount: 3,
    })
    const report = reconcileSlice('lifecycle', baseline, staticSlice)
    expect(report.slice).toBe('lifecycle')
    expect(report.findings).toEqual([])
    expect(report.staticMatched).toBe(true)
  })

  it('ignores execution tally rows when static projection is clean', () => {
    const baseline = makeBaseline({
      counts: {
        compileErrors: 0,
        ignored: 0,
        killed: 9,
        noCoverage: 0,
        pending: 0,
        runtimeErrors: 0,
        survived: 1,
        timeout: 0,
      },
      mutatorStatusTally: {
        'ArithmeticOperator:Killed': 9,
        'EqualityOperator:Survived': 1,
      },
    })
    const staticSlice = makeStaticSlice()
    const report = reconcileSlice('lifecycle', baseline, staticSlice)
    expect(report.findings).toEqual([])
    expect(report.staticMatched).toBe(true)
  })
})

describe('reconcileSlice — static drift', () => {
  it('emits count finding when counts.ignored differs', () => {
    const baseline = makeBaseline({
      counts: {
        compileErrors: 0,
        ignored: 2,
        killed: 0,
        noCoverage: 0,
        pending: 0,
        runtimeErrors: 0,
        survived: 0,
        timeout: 0,
      },
    })
    const staticSlice = makeStaticSlice()
    const report = reconcileSlice('lifecycle', baseline, staticSlice)
    const countFinding = report.findings.find((f) => f.kind === 'count' && f.key === 'ignored')
    expect(countFinding).toBeDefined()
    if (countFinding?.kind !== 'count') throw new Error('expected count finding')
    expect(countFinding.baseline).toBe(2)
    expect(countFinding.recomputed).toBe(0)
  })

  it('treats engine-recorded compileErrors as engine-owned, not statically recomputable', () => {
    const baseline = makeBaseline({
      counts: {
        compileErrors: 5,
        ignored: 0,
        killed: 0,
        noCoverage: 0,
        pending: 0,
        runtimeErrors: 0,
        survived: 0,
        timeout: 0,
      },
    })
    const staticSlice = makeStaticSlice({ compileErrorCount: 3 })
    const report = reconcileSlice('lifecycle', baseline, staticSlice)
    expect(report.findings).toEqual([])
    expect(report.staticMatched).toBe(true)
  })
})

describe('reconcileSlice — unblessed slice', () => {
  it('emits an unblessed finding when baseline is undefined', () => {
    const staticSlice = makeStaticSlice({ compileErrorCount: 3, familyTally: { BlockStatement: 3 } })
    const report = reconcileSlice('edge', undefined, staticSlice)
    expect(report.slice).toBe('edge')
    expect(report.findings).toHaveLength(1)
    expect(report.findings[0]?.kind).toBe('unblessed')
    expect(report.staticMatched).toBe(false)
  })
})

describe('formatDriftLine', () => {
  it('renders an ignored-count drift in the canonical ORACLE-DRIFT format', () => {
    const baseline = makeBaseline({
      slice: 'lifecycle',
      counts: {
        compileErrors: 0,
        ignored: 2,
        killed: 0,
        noCoverage: 0,
        pending: 0,
        runtimeErrors: 0,
        survived: 0,
        timeout: 0,
      },
    })
    const staticSlice = makeStaticSlice()
    const report = reconcileSlice('lifecycle', baseline, staticSlice)
    const finding = report.findings[0]
    expect(finding).toBeDefined()
    if (finding === undefined) throw new Error('expected finding')
    const line = formatDriftLine(finding)
    expect(line.startsWith('ORACLE-DRIFT lifecycle ')).toBe(true)
    expect(line).toContain('count:ignored')
    expect(line).toContain('2 -> 0')
  })

  it('renders an unblessed finding as ORACLE-DRIFT <slice> unblessed', () => {
    const line = formatDriftLine({ kind: 'unblessed', slice: 'edge' })
    expect(line).toBe('ORACLE-DRIFT edge unblessed')
  })
})
