import { Report } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Arr from 'effect/Array'
import * as Boolean from 'effect/Boolean'
import * as Order from 'effect/Order'
import * as S from 'effect/Schema'

import { BenchCorpusName } from './bench-run.schema.js'

export const BenchPhase = S.Literals([
  'prepare',
  'instrument',
  'check',
  'dry-run',
  'mutation-test',
  'reporting',
  'total',
])
export type BenchPhase = typeof BenchPhase.Type

export const SideSample = S.Struct({ ms: Report.NonNegativeFinite, shareOfTotal: Report.NonNegativeFinite })
export type SideSample = typeof SideSample.Type

export const SideCell = S.TaggedUnion({
  measured: { samples: S.NonEmptyArray(SideSample) },
  'not-run': {},
  'not-measured': {},
})
export type SideCell = typeof SideCell.Type

export type MeasuredSideCell = typeof SideCell.cases.measured.Type

export interface SampleStatistics {
  readonly minMs: number
  readonly medianMs: number
  readonly maxMs: number
  readonly shareMedian: number
}

const medianOfSorted = (sorted: Arr.NonEmptyReadonlyArray<number>): number => {
  const half = sorted.length / 2
  return Boolean.match(sorted.length % 2 === 1, {
    onTrue: () => sorted[Math.floor(half)],
    onFalse: () => (sorted[half - 1] + sorted[half]) / 2,
  })
}

export const statisticsOf = (cell: MeasuredSideCell): SampleStatistics => {
  const sorted = Arr.sort(Arr.map(cell.samples, (sample) => sample.ms), Order.Number)
  return {
    minMs: Arr.headNonEmpty(sorted),
    medianMs: medianOfSorted(sorted),
    maxMs: Arr.lastNonEmpty(sorted),
    shareMedian: medianOfSorted(Arr.sort(Arr.map(cell.samples, (sample) => sample.shareOfTotal), Order.Number)),
  }
}

export const PhaseVerdict = S.TaggedUnion({
  improved: { deltaMs: S.Finite, deltaShareOfA: S.Finite },
  regressed: { deltaMs: S.Finite, deltaShareOfA: S.Finite },
  'no-signal': { deltaMs: S.Finite },
  'workload-unverified': { reason: S.String },
  'not-measured': { reason: S.String },
})
export type PhaseVerdict = typeof PhaseVerdict.Type

export class BenchPhaseRow extends S.Class<BenchPhaseRow>('BenchPhaseRow')({
  phase: BenchPhase,
  a: SideCell,
  b: SideCell,
  verdict: PhaseVerdict,
}) {}

export const Workload = S.TaggedUnion({
  same: {},
  changed: { entries: S.Array(S.String) },
  unverified: { reasons: S.Array(S.String) },
})
export type Workload = typeof Workload.Type

const CountRange = S.Struct({ min: Report.NonNegativeInt, max: Report.NonNegativeInt })

export class SideCounts extends S.Class<SideCounts>('SideCounts')({
  mutants: CountRange,
  testsExecuted: CountRange,
}) {}

export const CorpusCounts = S.Struct({ a: SideCounts, b: SideCounts })

export class BenchProjectSummary extends S.Class<BenchProjectSummary>('BenchProjectSummary')({
  corpus: BenchCorpusName,
  entry: S.NonEmptyString,
  workload: Workload,
  counts: CorpusCounts,
  rows: S.Array(BenchPhaseRow),
}) {}

const BenchSummaryTypeId: unique symbol = Symbol.for('@systemfsoftware/stryker-e2e-core/BenchSummary')
type BenchSummaryTypeId = typeof BenchSummaryTypeId

export class BenchSummary extends S.TaggedClass<BenchSummary>()('BenchSummary', {
  projects: S.Array(BenchProjectSummary),
}) {
  readonly [BenchSummaryTypeId] = BenchSummaryTypeId
}
