import { Report } from '@systemfsoftware/stryker-js-plugin-interface'
import * as S from 'effect/Schema'

import { BenchCorpusName } from './bench-run.schema.js'

const PHASES = ['prepare', 'instrument', 'check', 'dry-run', 'mutation-test', 'reporting', 'total'] as const
export type BenchPhase = (typeof PHASES)[number]

export const SideCell = S.TaggedUnion({
  measured: {
    medianMs: Report.NonNegativeFinite,
    minMs: Report.NonNegativeFinite,
    maxMs: Report.NonNegativeFinite,
    shareMedian: Report.NonNegativeFinite,
    notRunEntries: Report.NonNegativeInt,
    samplesMs: S.Array(S.Finite),
  },
  'not-measured': {},
})
export type SideCell = typeof SideCell.Type

export const PhaseVerdict = S.TaggedUnion({
  improved: { deltaMs: S.Finite, deltaShareOfA: S.Finite },
  regressed: { deltaMs: S.Finite, deltaShareOfA: S.Finite },
  'no-signal': { deltaMs: S.Finite },
  'not-measured': { reason: S.String },
})
export type PhaseVerdict = typeof PhaseVerdict.Type

export class BenchPhaseRow extends S.Class<BenchPhaseRow>('BenchPhaseRow')({
  phase: S.Literals(PHASES),
  a: SideCell,
  b: SideCell,
  verdict: PhaseVerdict,
}) {}

export const Workload = S.TaggedUnion({
  same: {},
  changed: { entries: S.Array(S.String) },
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
