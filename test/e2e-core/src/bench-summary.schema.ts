import { Report } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Arr from 'effect/Array'
import * as Boolean from 'effect/Boolean'
import * as Order from 'effect/Order'
import * as Result from 'effect/Result'
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

export const RegressedMetric = S.Struct({
  corpus: BenchCorpusName,
  entry: S.NonEmptyString,
  phase: BenchPhase,
  deltaMs: S.Finite,
  deltaShareOfA: S.Finite,
})
export type RegressedMetric = typeof RegressedMetric.Type

export const PhaseRegression = S.Struct({
  code: S.Literal('phase-regressed'),
  sha: S.String,
  baseSha: S.String,
  metrics: S.NonEmptyArray(RegressedMetric),
  nextAction: S.NonEmptyString,
})
export type PhaseRegression = typeof PhaseRegression.Type

const BenchSummaryTypeId: unique symbol = Symbol.for('@systemfsoftware/stryker-e2e-core/BenchSummary')
type BenchSummaryTypeId = typeof BenchSummaryTypeId

export class BenchSummary extends S.TaggedClass<BenchSummary>()('BenchSummary', {
  projects: S.Array(BenchProjectSummary),
  regression: S.NullOr(PhaseRegression),
}) {
  readonly [BenchSummaryTypeId] = BenchSummaryTypeId
}

const METRIC = { corpus: 'repo', entry: 'entry', phase: 'total', deltaMs: 12, deltaShareOfA: 0.05 } as const

const acceptsMetric = (metric: typeof RegressedMetric.Encoded): boolean =>
  Result.isSuccess(S.decodeResult(RegressedMetric)(metric))

const acceptsRegression = (fields: Partial<typeof PhaseRegression.Encoded>): boolean =>
  Result.isSuccess(
    S.decodeResult(PhaseRegression)({
      code: 'phase-regressed',
      sha: 'head',
      baseSha: 'base',
      metrics: [METRIC],
      nextAction: 'next',
      ...fields,
    }),
  )

const textFieldVerdicts = (value: string): ReadonlyArray<boolean> => [
  acceptsMetric({ ...METRIC, entry: value }),
  acceptsRegression({ nextAction: value }),
]

const deltaFieldVerdicts = (value: number): ReadonlyArray<boolean> => [
  acceptsMetric({ ...METRIC, deltaMs: value }),
  acceptsMetric({ ...METRIC, deltaShareOfA: value }),
]

const acceptsRegressionCode = (code: string): boolean =>
  Result.isSuccess(
    S.decodeUnknownResult(PhaseRegression)({
      code,
      sha: 'head',
      baseSha: 'base',
      metrics: [METRIC],
      nextAction: 'next',
    }),
  )

const acceptsMetricCount = (metrics: ReadonlyArray<RegressedMetric>): boolean =>
  Result.isSuccess(
    S.decodeUnknownResult(PhaseRegression)({
      code: 'phase-regressed',
      sha: 'head',
      baseSha: 'base',
      metrics,
      nextAction: 'next',
    }),
  )

if (import.meta.vitest !== void 0) {
  const { it } = await import('@systemfsoftware/vitest')

  it.prop(
    '∀s_RegressionTextRefusal_≡EntryAndNextActionRefuseOnlyTheEmptyString',
    { of: [S.String], subject: textFieldVerdicts },
    (subject, [drawn]) =>
      Arr.every(
        Arr.append(['', ' ', 'entry'], drawn),
        (value) => Arr.every(subject(value), (accepted) => accepted === value.length > 0),
      ),
  )

  it.prop(
    '∀n_RegressionDeltaRefusal_≡DeltasAreFinite',
    { of: [S.Finite], subject: deltaFieldVerdicts },
    (subject, [drawn]) =>
      Arr.every(
        Arr.append([-1, 0, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY], drawn),
        (value) => Arr.every(subject(value), (accepted) => accepted === Number.isFinite(value)),
      ),
  )

  it.prop(
    '∀s_RegressionCodeRefusal_≡OnlyPhaseRegressed',
    { of: [S.String], subject: acceptsRegressionCode },
    (subject, [drawn]) =>
      Arr.every(
        Arr.append(['', 'phase-regressed', 'phase-regressed ', 'regressed'], drawn),
        (code) => subject(code) === (code === 'phase-regressed'),
      ),
  )

  it.prop(
    '∀m_RegressionMetricsRefusal_≡AtLeastOneMetric',
    { of: [S.Array(RegressedMetric)], subject: acceptsMetricCount },
    (subject, [drawn]) => Arr.every([[], [METRIC], drawn], (metrics) => subject(metrics) === metrics.length > 0),
  )
}
