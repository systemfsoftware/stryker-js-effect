import { describe } from '@systemfsoftware/vitest'
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

function makeStaticSlice(
  overrides: Partial<{
    familyTally: Readonly<Record<string, number>>
    placementTally: Readonly<Record<string, number>>
    ignoredCount: number
    compileErrorCount: number
    compileErrorCodes: Readonly<Record<number, number>>
  }> = {},
) {
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

describe('reconcileSlice — happy path', (it) => {
  it('reports zero findings when baseline matches recomputation', function*({ expect }) {
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

    yield* expect({ slice: report.slice, findings: report.findings, staticMatched: report.staticMatched }).toEqual({
      slice: 'lifecycle',
      findings: [],
      staticMatched: true,
    })
  })

  it('ignores execution tally rows when static projection is clean', function*({ expect }) {
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

    yield* expect({ findings: report.findings, staticMatched: report.staticMatched }).toEqual({
      findings: [],
      staticMatched: true,
    })
  })
})

describe('reconcileSlice — static drift', (it) => {
  it('emits count finding when counts.ignored differs', function*({ expect }) {
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

    yield* expect(countFinding).toMatchObject({ kind: 'count', key: 'ignored', baseline: 2, recomputed: 0 })
  })

  it('treats engine-recorded compileErrors as engine-owned, not statically recomputable', function*({ expect }) {
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

    yield* expect({ findings: report.findings, staticMatched: report.staticMatched }).toEqual({
      findings: [],
      staticMatched: true,
    })
  })
})

describe('reconcileSlice — unblessed slice', (it) => {
  it('emits an unblessed finding when baseline is undefined', function*({ expect }) {
    const staticSlice = makeStaticSlice({ compileErrorCount: 3, familyTally: { BlockStatement: 3 } })
    const report = reconcileSlice('edge', undefined, staticSlice)

    yield* expect({ slice: report.slice, findings: report.findings, staticMatched: report.staticMatched }).toEqual({
      slice: 'edge',
      findings: [expect.objectContaining({ kind: 'unblessed' })],
      staticMatched: false,
    })
  })
})

describe('formatDriftLine', (it) => {
  it('renders an ignored-count drift in the canonical ORACLE-DRIFT format', function*({ expect }) {
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
    if (finding === undefined) throw new Error('expected a drift finding')

    yield* expect(formatDriftLine(finding)).toMatch(/^ORACLE-DRIFT lifecycle count:ignored 2 -> 0$/)
  })

  it('renders an unblessed finding as ORACLE-DRIFT <slice> unblessed', function*({ expect }) {
    yield* expect(formatDriftLine({ kind: 'unblessed', slice: 'edge' })).toBe('ORACLE-DRIFT edge unblessed')
  })
})
