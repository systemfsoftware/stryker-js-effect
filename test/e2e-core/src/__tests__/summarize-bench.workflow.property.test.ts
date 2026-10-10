import { RunEvent } from '@systemfsoftware/stryker-js-cli-contract'
import { describe, it } from '@systemfsoftware/vitest'
import * as Match from 'effect/Match'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import { BenchRun, BenchRunInvalid, BenchRunKey, BenchRunMeasured } from '../bench-run.schema.js'
import { type BenchSummary, PhaseVerdict, SideCell, Workload } from '../bench-summary.schema.js'
import { BenchRunsInvalid, summarizeBench, SummarizeBenchCommand } from '../summarize-bench.workflow.js'

const NOT_RECORDED: RunEvent.CheckDuration = { _tag: 'not-recorded' }
const NOT_RUN: RunEvent.CheckDuration = { _tag: 'not-run' }
const REPORTING_MEASURED: RunEvent.ReportingDuration = { _tag: 'measured', ms: 0 }
const REPORTING_NOT_RECORDED: RunEvent.ReportingDuration = { _tag: 'not-recorded' }

interface RunOptions {
  readonly check?: RunEvent.CheckDuration
  readonly reporting?: RunEvent.ReportingDuration
  readonly digest?: string
}

const runFrom = (
  side: 'A' | 'B',
  position: number,
  mutationTest: number,
  options: RunOptions = {},
): BenchRunMeasured =>
  BenchRunMeasured.make({
    key: BenchRunKey.make({ corpus: 'repo', entry: 'entry', side, position }),
    phaseDurations: {
      prepare: 0,
      instrument: 0,
      'dry-run': 0,
      'mutation-test': mutationTest,
      check: options.check ?? NOT_RECORDED,
      reporting: options.reporting ?? REPORTING_MEASURED,
    },
    mutants: 10,
    testsExecuted: 2,
    workloadDigest: options.digest ?? 'digest-entry',
    wallMs: mutationTest,
    exitCode: 0,
  })

const fourRuns = (
  side: 'A' | 'B',
  samples: ReadonlyArray<number>,
  options: RunOptions = {},
): ReadonlyArray<BenchRunMeasured> => [
  runFrom(side, 0, samples[0], options),
  runFrom(side, 1, samples[1], options),
  runFrom(side, 2, samples[2], options),
  runFrom(side, 3, samples[3], options),
]

const runsOf = (aSamples: ReadonlyArray<number>, bSamples: ReadonlyArray<number>): ReadonlyArray<BenchRun> => [
  ...fourRuns('A', aSamples),
  ...fourRuns('B', bSamples),
]

const runsWithChecks = (aSamples: ReadonlyArray<number>, bSamples: ReadonlyArray<number>): ReadonlyArray<BenchRun> => [
  runFrom('A', 0, aSamples[0]),
  runFrom('A', 1, aSamples[1]),
  runFrom('A', 2, aSamples[2]),
  runFrom('A', 3, aSamples[3]),
  runFrom('B', 0, bSamples[0], { check: { _tag: 'measured', ms: bSamples[0] } }),
  runFrom('B', 1, bSamples[1], { check: { _tag: 'measured', ms: bSamples[1] } }),
  runFrom('B', 2, bSamples[2], { check: { _tag: 'measured', ms: bSamples[2] } }),
  runFrom('B', 3, bSamples[3], { check: { _tag: 'measured', ms: bSamples[3] } }),
]

const allNotRunA = (aSamples: ReadonlyArray<number>): ReadonlyArray<BenchRun> =>
  fourRuns('A', aSamples, { check: NOT_RUN })

const reportingUnrecordedA = (
  aSamples: ReadonlyArray<number>,
  bSamples: ReadonlyArray<number>,
): ReadonlyArray<BenchRun> => [
  ...fourRuns('A', aSamples, { reporting: REPORTING_NOT_RECORDED }),
  ...fourRuns('B', bSamples),
]

const withInvalidA = (
  aSamples: ReadonlyArray<number>,
  bSamples: ReadonlyArray<number>,
  mask: ReadonlyArray<boolean>,
  reason: string,
): ReadonlyArray<BenchRun> => [
  ...maskA(mask, aSamples, reason),
  ...fourRuns('B', bSamples),
]

const maskA = (
  mask: ReadonlyArray<boolean>,
  aSamples: ReadonlyArray<number>,
  reason: string,
): ReadonlyArray<BenchRun> => [
  mask[0] === true
    ? BenchRunInvalid.make({
      key: BenchRunKey.make({ corpus: 'repo', entry: 'entry', side: 'A', position: 0 }),
      reason,
      lineNumber: null,
    })
    : runFrom('A', 0, aSamples[0]),
  mask[1] === true
    ? BenchRunInvalid.make({
      key: BenchRunKey.make({ corpus: 'repo', entry: 'entry', side: 'A', position: 1 }),
      reason,
      lineNumber: null,
    })
    : runFrom('A', 1, aSamples[1]),
  mask[2] === true
    ? BenchRunInvalid.make({
      key: BenchRunKey.make({ corpus: 'repo', entry: 'entry', side: 'A', position: 2 }),
      reason,
      lineNumber: null,
    })
    : runFrom('A', 2, aSamples[2]),
  mask[3] === true
    ? BenchRunInvalid.make({
      key: BenchRunKey.make({ corpus: 'repo', entry: 'entry', side: 'A', position: 3 }),
      reason,
      lineNumber: null,
    })
    : runFrom('A', 3, aSamples[3]),
]

const withDriftedDigest = (runs: ReadonlyArray<BenchRunMeasured>, digest: string): ReadonlyArray<BenchRunMeasured> =>
  runs.map((run, index) => index === 0 ? runFrom('A', 0, run.phaseDurations['mutation-test'], { digest }) : run)

const positives = (values: ReadonlyArray<number>): ReadonlyArray<number> => values.map((value) => Math.abs(value) + 1)

type Subject = (command: SummarizeBenchCommand) => Result.Result<BenchSummary, BenchRunsInvalid>

const summaryOf = (subject: Subject, runs: ReadonlyArray<BenchRun>): BenchSummary =>
  Result.getOrThrow(subject(SummarizeBenchCommand.make({ runs })))

const rowOf = (summary: BenchSummary, phase: string) => {
  const row = summary.projects[0].rows.find((candidate) => candidate.phase === phase)
  if (row === undefined) {
    throw new Error(`no ${phase} row was summarized`)
  }
  return row
}

const isImproved = (verdict: PhaseVerdict): boolean => S.is(PhaseVerdict.cases.improved)(verdict)
const isRegressed = (verdict: PhaseVerdict): boolean => S.is(PhaseVerdict.cases.regressed)(verdict)
const isNoSignal = (verdict: PhaseVerdict): boolean => S.is(PhaseVerdict.cases['no-signal'])(verdict)
const isNotMeasuredVerdict = (verdict: PhaseVerdict): boolean => S.is(PhaseVerdict.cases['not-measured'])(verdict)
const deltaOf = (verdict: PhaseVerdict): number | null =>
  S.is(PhaseVerdict.cases['not-measured'])(verdict) ? null : verdict.deltaMs
const isSideMeasured = (cell: SideCell): boolean => S.is(SideCell.cases.measured)(cell)
const sideMedian = (cell: SideCell): number | null => S.is(SideCell.cases.measured)(cell) ? cell.medianMs : null
const sideShare = (cell: SideCell): number | null => S.is(SideCell.cases.measured)(cell) ? cell.shareMedian : null
const sideNotRun = (cell: SideCell): number | null => S.is(SideCell.cases.measured)(cell) ? cell.notRunEntries : null

const sideSamples = (cell: SideCell): ReadonlyArray<number> | null =>
  Match.value(cell).pipe(
    Match.tag('measured', (measured) => measured.samplesMs),
    Match.tag('not-measured', () => null),
    Match.exhaustive,
  )

const labelsOf = (runs: ReadonlyArray<BenchRun>): string =>
  runs.map((run) => `${run.key.side}@${run.key.position}`).join(',')

const near = (left: number, right: number): boolean =>
  Math.abs(left - right) <= 1e-9 * Math.max(1, Math.abs(left), Math.abs(right))

describe('summarizeBench', () => {
  it.prop(
    '∀ab_SidesSwapped_≡DeltaNegatedAndVerdictsSwapped',
    { of: [S.Tuple([S.Int, S.Int, S.Int, S.Int]), S.Tuple([S.Int, S.Int, S.Int, S.Int])], subject: summarizeBench },
    (subject, [rawA, rawB]) => {
      const forward = rowOf(summaryOf(subject, runsOf(positives(rawA), positives(rawB))), 'mutation-test').verdict
      const swapped = rowOf(summaryOf(subject, runsOf(positives(rawB), positives(rawA))), 'mutation-test').verdict
      const forwardDelta = deltaOf(forward)
      const swappedDelta = deltaOf(swapped)
      return forwardDelta !== null && swappedDelta !== null && near(forwardDelta + swappedDelta, 0) &&
        isImproved(forward) === isRegressed(swapped) &&
        isRegressed(forward) === isImproved(swapped)
    },
  )

  it.prop(
    '∀a_IdenticalSides_≡ZeroDeltaNoSignal',
    { of: [S.Tuple([S.Int, S.Int, S.Int, S.Int])], subject: summarizeBench },
    (subject, [rawA]) => {
      const row = rowOf(summaryOf(subject, runsOf(positives(rawA), positives(rawA))), 'mutation-test')
      return deltaOf(row.verdict) === 0 && isNoSignal(row.verdict) && sideMedian(row.a) === sideMedian(row.b)
    },
  )

  it.prop(
    '∀abc_ConstantAddedToB_≡DeltaShiftedByTheConstant',
    {
      of: [S.Tuple([S.Int, S.Int, S.Int, S.Int]), S.Tuple([S.Int, S.Int, S.Int, S.Int]), S.Int],
      subject: summarizeBench,
    },
    (subject, [rawA, rawB, rawShift]) => {
      const shift = Math.abs(rawShift)
      const a = positives(rawA)
      const b = positives(rawB)
      const base = rowOf(summaryOf(subject, runsOf(a, b)), 'mutation-test')
      const shifted = rowOf(summaryOf(subject, runsOf(a, b.map((sample) => sample + shift))), 'mutation-test')
      const baseDelta = deltaOf(base.verdict)
      const shiftedDelta = deltaOf(shifted.verdict)
      const baseMedian = sideMedian(base.b)
      const shiftedMedian = sideMedian(shifted.b)
      return baseDelta !== null && shiftedDelta !== null && baseMedian !== null && shiftedMedian !== null &&
        near(shiftedDelta, baseDelta + shift) &&
        near(shiftedMedian, baseMedian + shift)
    },
  )

  it.prop(
    '∀abk_EverySampleScaled_≡VerdictKeptAndDeltaScaled',
    {
      of: [S.Tuple([S.Int, S.Int, S.Int, S.Int]), S.Tuple([S.Int, S.Int, S.Int, S.Int]), S.Int],
      subject: summarizeBench,
    },
    (subject, [rawA, rawB, rawScale]) => {
      const scale = Math.abs(rawScale) + 1
      const a = positives(rawA)
      const b = positives(rawB)
      const base = rowOf(summaryOf(subject, runsOf(a, b)), 'mutation-test').verdict
      const scaled = rowOf(
        summaryOf(subject, runsOf(a.map((sample) => sample * scale), b.map((sample) => sample * scale))),
        'mutation-test',
      ).verdict
      const baseDelta = deltaOf(base)
      const scaledDelta = deltaOf(scaled)
      return isImproved(base) === isImproved(scaled) &&
        isRegressed(base) === isRegressed(scaled) &&
        baseDelta !== null && scaledDelta !== null &&
        near(scaledDelta, baseDelta * scale)
    },
  )

  it.prop(
    '∀ab_ReversedRunOrder_≡SameSummary',
    { of: [S.Tuple([S.Int, S.Int, S.Int, S.Int]), S.Tuple([S.Int, S.Int, S.Int, S.Int])], subject: summarizeBench },
    (subject, [rawA, rawB]) => {
      const runs = runsOf(positives(rawA), positives(rawB))
      const forward = summaryOf(subject, runs)
      const reversed = summaryOf(subject, [...runs].reverse())
      return JSON.stringify(forward.projects) === JSON.stringify(reversed.projects)
    },
  )

  it.prop(
    '∀abd_OneDifferingDigest_≡ProjectWorkloadChangedAndNoSignal',
    {
      of: [S.Tuple([S.Int, S.Int, S.Int, S.Int]), S.Tuple([S.Int, S.Int, S.Int, S.Int]), S.NonEmptyString],
      subject: summarizeBench,
    },
    (subject, [rawA, rawB, digest]) => {
      const runs = withDriftedDigest([...fourRuns('A', positives(rawA)), ...fourRuns('B', positives(rawB))], digest)
      const summary = summaryOf(subject, runs)
      const verdict = rowOf(summary, 'mutation-test').verdict
      return S.is(Workload.cases.changed)(summary.projects[0].workload) &&
        isImproved(verdict) === false && isRegressed(verdict) === false
    },
  )

  it.prop(
    '∀abrm_AnyInvalidRun_≡RefusedNamingExactlyThose',
    {
      of: [
        S.Tuple([S.Int, S.Int, S.Int, S.Int]),
        S.Tuple([S.Int, S.Int, S.Int, S.Int]),
        S.NonEmptyString,
        S.Tuple([S.Boolean, S.Boolean, S.Boolean, S.Boolean]),
      ],
      subject: summarizeBench,
    },
    (subject, [rawA, rawB, reason, mask]) => {
      const runs = withInvalidA(positives(rawA), positives(rawB), mask, reason)
      const expected = labelsOf(runs.filter((run) => S.is(BenchRunInvalid)(run)))
      return Result.match(subject(SummarizeBenchCommand.make({ runs })), {
        onFailure: (failure) => S.is(BenchRunsInvalid)(failure) && labelsOf(failure.runs) === expected,
        onSuccess: () => expected.length === 0,
      })
    },
  )

  it.prop(
    '∀ab_CheckNotRecorded_≡CheckCellNotMeasured',
    { of: [S.Tuple([S.Int, S.Int, S.Int, S.Int]), S.Tuple([S.Int, S.Int, S.Int, S.Int])], subject: summarizeBench },
    (subject, [rawA, rawB]) => {
      const row = rowOf(summaryOf(subject, runsWithChecks(positives(rawA), positives(rawB))), 'check')
      return isSideMeasured(row.a) === false && isSideMeasured(row.b) && sideMedian(row.a) === null &&
        isNotMeasuredVerdict(row.verdict)
    },
  )

  it.prop(
    '∀a_EveryCheckNotRun_≡MeasuredWithNotRunEntries',
    { of: [S.Tuple([S.Int, S.Int, S.Int, S.Int])], subject: summarizeBench },
    (subject, [rawA]) => {
      const row = rowOf(summaryOf(subject, allNotRunA(positives(rawA))), 'check')
      return isSideMeasured(row.a) && sideMedian(row.a) === 0 && sideNotRun(row.a) === 1
    },
  )

  it.prop(
    '∀ab_ReportingNotRecorded_≡ReportingNotMeasuredAndMutationVerdictNotMeasured',
    { of: [S.Tuple([S.Int, S.Int, S.Int, S.Int]), S.Tuple([S.Int, S.Int, S.Int, S.Int])], subject: summarizeBench },
    (subject, [rawA, rawB]) => {
      const summary = summaryOf(subject, reportingUnrecordedA(positives(rawA), positives(rawB)))
      const reporting = rowOf(summary, 'reporting')
      const mutation = rowOf(summary, 'mutation-test')
      return isSideMeasured(reporting.a) === false &&
        isSideMeasured(reporting.b) &&
        isNotMeasuredVerdict(mutation.verdict) &&
        isSideMeasured(mutation.a)
    },
  )

  it.prop(
    '∀ab_TotalRow_≡ShareMedianIsOne',
    { of: [S.Tuple([S.Int, S.Int, S.Int, S.Int]), S.Tuple([S.Int, S.Int, S.Int, S.Int])], subject: summarizeBench },
    (subject, [rawA, rawB]) => {
      const row = rowOf(summaryOf(subject, runsOf(positives(rawA), positives(rawB))), 'total')
      return sideShare(row.a) === 1 && sideShare(row.b) === 1
    },
  )

  it.prop(
    '∀ab_Samples_≡EverySideSampleInPositionOrder',
    { of: [S.Tuple([S.Int, S.Int, S.Int, S.Int]), S.Tuple([S.Int, S.Int, S.Int, S.Int])], subject: summarizeBench },
    (subject, [rawA, rawB]) => {
      const a = positives(rawA)
      const b = positives(rawB)
      const row = rowOf(summaryOf(subject, runsOf(a, b)), 'mutation-test')
      return JSON.stringify(sideSamples(row.a)) === JSON.stringify(a) &&
        JSON.stringify(sideSamples(row.b)) === JSON.stringify(b)
    },
  )

  it.prop(
    '∀ab_Projects_≡OnePerEntryWithThePhaseOrder',
    { of: [S.Tuple([S.Int, S.Int, S.Int, S.Int]), S.Tuple([S.Int, S.Int, S.Int, S.Int])], subject: summarizeBench },
    (subject, [rawA, rawB]) => {
      const summary = summaryOf(subject, runsOf(positives(rawA), positives(rawB)))
      const phases = summary.projects[0].rows.map((row) => row.phase).join(',')
      return summary.projects.length === 1 &&
        summary.projects[0].corpus === 'repo' &&
        summary.projects[0].entry === 'entry' &&
        phases === 'prepare,instrument,check,dry-run,mutation-test,reporting,total'
    },
  )
})
