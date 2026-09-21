import { describe, expect, it } from 'vitest'
import {
  type BlessedBaseline,
  formatDriftLine,
  reconcileSlice,
  splitStaticAndExecutionTally,
} from './reconcile-oracle.js'

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
  ignoredCount: number
  compileErrorCount: number
  compileErrorCodes: Readonly<Record<number, number>>
}> = {}) {
  return {
    familyTally: {},
    ignoredCount: 0,
    compileErrorCount: 0,
    compileErrorCodes: {},
    blockers: [],
    ...overrides,
  }
}

describe('splitStaticAndExecutionTally', () => {
  it('separates CompileError/Ignored rows from execution rows', () => {
    const tally = {
      'ArrowFunction:CompileError': 13,
      'BlockStatement:CompileError': 14,
      'ArithmeticOperator:Killed': 9,
      'ConditionalExpression:Survived': 1,
    }
    const { staticRows, executionRows } = splitStaticAndExecutionTally(tally)
    expect(staticRows).toEqual({
      'ArrowFunction:CompileError': 13,
      'BlockStatement:CompileError': 14,
    })
    expect(executionRows).toEqual({
      'ArithmeticOperator:Killed': 9,
      'ConditionalExpression:Survived': 1,
    })
  })

  it('returns empty maps for an empty tally', () => {
    const { staticRows, executionRows } = splitStaticAndExecutionTally({})
    expect(staticRows).toEqual({})
    expect(executionRows).toEqual({})
  })

  it('treats all rows as execution when only execution statuses are present', () => {
    const tally = {
      'ArithmeticOperator:Killed': 9,
      'ConditionalExpression:Survived': 1,
    }
    const { staticRows, executionRows } = splitStaticAndExecutionTally(tally)
    expect(staticRows).toEqual({})
    expect(executionRows).toEqual(tally)
  })
})

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
  it('emits count finding when counts.compileErrors differs', () => {
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
    const countFinding = report.findings.find((f) => f.kind === 'count' && f.key === 'compileErrors')
    expect(countFinding).toBeDefined()
    if (countFinding?.kind !== 'count') throw new Error('expected count finding')
    expect(countFinding.baseline).toBe(5)
    expect(countFinding.recomputed).toBe(3)
    expect(report.staticMatched).toBe(false)
  })

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

  it('emits tally finding when a CompileError tally row differs', () => {
    const baseline = makeBaseline({
      mutatorStatusTally: { 'BlockStatement:CompileError': 5 },
    })
    const staticSlice = makeStaticSlice({
      familyTally: { BlockStatement: 3 },
      compileErrorCount: 3,
    })
    const report = reconcileSlice('lifecycle', baseline, staticSlice)
    const tallyFinding = report.findings.find((f) => f.kind === 'tally' && f.status === 'CompileError')
    expect(tallyFinding).toBeDefined()
    if (tallyFinding?.kind !== 'tally') throw new Error('expected tally finding')
    expect(tallyFinding.family).toBe('BlockStatement')
    expect(tallyFinding.baseline).toBe(5)
    expect(tallyFinding.recomputed).toBe(3)
  })

  it('emits tally-missing finding when recomputation has a static row not in baseline', () => {
    const baseline = makeBaseline()
    const staticSlice = makeStaticSlice({
      familyTally: { 'NewFamily': 4 },
      compileErrorCount: 4,
    })
    const report = reconcileSlice('lifecycle', baseline, staticSlice)
    const missingFinding = report.findings.find((f) => f.kind === 'tally-missing')
    expect(missingFinding).toBeDefined()
    if (missingFinding?.kind !== 'tally-missing') throw new Error('expected tally-missing finding')
    expect(missingFinding.family).toBe('NewFamily')
    expect(missingFinding.status).toBe('CompileError')
    expect(missingFinding.recomputed).toBe(4)
  })
})

describe('reconcileSlice — needs-rebless for engine rows of drifting families', () => {
  it('does not flag engine rows of non-drifting families', () => {
    const baseline = makeBaseline({
      counts: {
        compileErrors: 5,
        ignored: 0,
        killed: 9,
        noCoverage: 0,
        pending: 0,
        runtimeErrors: 0,
        survived: 0,
        timeout: 0,
      },
      mutatorStatusTally: {
        'BlockStatement:CompileError': 5,
        'ArithmeticOperator:Killed': 9,
      },
    })
    const staticSlice = makeStaticSlice({
      familyTally: { BlockStatement: 3 },
      compileErrorCount: 3,
    })
    const report = reconcileSlice('lifecycle', baseline, staticSlice)
    const reBless = report.findings.filter((f) => f.kind === 'needs-rebless')
    expect(reBless).toHaveLength(0)
  })

  it('flags engine rows of drifting families as needs-rebless', () => {
    const baseline = makeBaseline({
      counts: {
        compileErrors: 5,
        ignored: 0,
        killed: 9,
        noCoverage: 0,
        pending: 0,
        runtimeErrors: 0,
        survived: 0,
        timeout: 0,
      },
      mutatorStatusTally: {
        'BlockStatement:CompileError': 5,
        'BlockStatement:Killed': 9,
      },
    })
    const staticSlice = makeStaticSlice({
      familyTally: { BlockStatement: 3 },
      compileErrorCount: 3,
    })
    const report = reconcileSlice('lifecycle', baseline, staticSlice)
    const reBless = report.findings.filter((f) => f.kind === 'needs-rebless')
    expect(reBless).toHaveLength(1)
    const first = reBless[0]
    if (first?.kind !== 'needs-rebless') throw new Error('expected needs-rebless finding')
    expect(first).toMatchObject({
      kind: 'needs-rebless',
      slice: 'lifecycle',
      family: 'BlockStatement',
      status: 'Killed',
      tallyBaseline: 9,
    })
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
  it('renders a count drift in the canonical ORACLE-DRIFT format', () => {
    const baseline = makeBaseline({ slice: 'lifecycle' })
    const staticSlice = makeStaticSlice({ compileErrorCount: 3 })
    const report = reconcileSlice('lifecycle', baseline, staticSlice)
    const finding = report.findings[0]
    expect(finding).toBeDefined()
    if (finding === undefined) throw new Error('expected finding')
    const line = formatDriftLine(finding)
    expect(line.startsWith('ORACLE-DRIFT lifecycle ')).toBe(true)
    expect(line).toContain('count:compileErrors')
    expect(line).toContain('0 -> 3')
  })

  it('renders a tally drift with family:status', () => {
    const baseline = makeBaseline({
      mutatorStatusTally: { 'BlockStatement:CompileError': 5 },
    })
    const staticSlice = makeStaticSlice({
      familyTally: { BlockStatement: 3 },
      compileErrorCount: 3,
    })
    const report = reconcileSlice('lifecycle', baseline, staticSlice)
    const tallyFinding = report.findings.find((f) => f.kind === 'tally')
    expect(tallyFinding).toBeDefined()
    if (tallyFinding === undefined || tallyFinding.kind !== 'tally') throw new Error('expected tally finding')
    const line = formatDriftLine(tallyFinding)
    expect(line.startsWith('ORACLE-DRIFT lifecycle ')).toBe(true)
    expect(line).toContain('BlockStatement:CompileError')
    expect(line).toContain('5 -> 3')
  })

  it('renders an unblessed finding as ORACLE-DRIFT <slice> unblessed', () => {
    const line = formatDriftLine({ kind: 'unblessed', slice: 'edge' })
    expect(line).toBe('ORACLE-DRIFT edge unblessed')
  })

  it('renders a needs-rebless finding with the family:status and tally baseline', () => {
    const line = formatDriftLine({
      kind: 'needs-rebless',
      slice: 'lifecycle',
      family: 'ArithmeticOperator',
      status: 'Killed',
      tallyBaseline: 9,
    })
    expect(line).toBe('ORACLE-DRIFT lifecycle ArithmeticOperator:Killed needs-rebless baseline=9')
  })

  it('renders a tally-missing finding', () => {
    const line = formatDriftLine({
      kind: 'tally-missing',
      slice: 'lifecycle',
      family: 'NewFamily',
      status: 'CompileError',
      recomputed: 4,
    })
    expect(line).toBe('ORACLE-DRIFT lifecycle NewFamily:CompileError missing-in-baseline recomputed=4')
  })
})
