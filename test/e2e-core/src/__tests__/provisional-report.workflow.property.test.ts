import { describe, it } from '@systemfsoftware/vitest'
import * as Arbitrary from 'effect/Arbitrary'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import { BENCH_ORDER } from '../bench-order.js'
import {
  BenchAbortCode,
  type BenchReport,
  BenchReportOutcome,
  LegMeasured,
  ProvisionalAborted,
  ProvisionalRunNext,
  ProvisionalSetupNext,
  ProvisionalSummarizeNext,
  SetupPoint,
  SetupStep,
} from '../bench-report.schema.js'
import { type BenchRun, BenchRunInvalid, BenchRunKey, BenchRunMeasured } from '../bench-run.schema.js'
import { WithheldPins } from '../lockfile-pins.schema.js'
import { provisionalReport, ProvisionalReportCommand } from '../provisional-report.workflow.js'

const keyAt = (position: number): BenchRunKey =>
  BenchRunKey.make({ corpus: 'repo', entry: 'entry', side: BENCH_ORDER[position], position })

const measuredAt = (position: number, wallMs: number): BenchRunMeasured =>
  BenchRunMeasured.make({
    key: keyAt(position),
    phaseDurations: {
      prepare: 0,
      instrument: 0,
      'dry-run': 0,
      'mutation-test': wallMs,
      check: { _tag: 'not-recorded' },
      reporting: { _tag: 'measured', ms: 0 },
    },
    mutants: 10,
    testsExecuted: 2,
    workloadDigest: { _tag: 'verified', digest: 'digest-entry' },
    identity: { _tag: 'read', projectRoot: '/run', runInputsDigest: 'inputs', mutantIdsDigest: 'ids' },
    wallMs,
    exitCode: 0,
  })

const invalidAt = (position: number): BenchRunInvalid =>
  BenchRunInvalid.make({
    key: keyAt(position),
    code: 'stream-invalid',
    reason: 'no verdict line',
    lineNumber: null,
    exitCode: 1,
    stderrTail: '',
  })

const finishedOf = (
  samples: ReadonlyArray<number>,
  invalidMask: ReadonlyArray<boolean> = [],
): ReadonlyArray<BenchRun> =>
  samples.map((sample, position) =>
    invalidMask[position] === true ? invalidAt(position) : measuredAt(position, Math.abs(sample))
  )

interface SetupState {
  readonly setup: SetupPoint | null
  readonly setupSteps: ReadonlyArray<SetupStep>
  readonly withheldPins: ReadonlyArray<WithheldPins>
}

const NO_SETUP: SetupState = { setup: null, setupSteps: [], withheldPins: [] }

const commandOf = (
  finished: ReadonlyArray<BenchRun>,
  abort: ProvisionalReportCommand['abort'] = null,
  state: SetupState = NO_SETUP,
): ProvisionalReportCommand =>
  ProvisionalReportCommand.make({
    baseSha: 'base',
    headSha: 'head',
    ref: 'refs/heads/main',
    leg: LegMeasured.make({ wallMs: 60_000, targetMs: 600_000 }),
    order: [...BENCH_ORDER],
    finished: [...finished],
    setupSteps: [...state.setupSteps],
    withheldPins: [...state.withheldPins],
    setup: state.setup,
    abort,
  })

const nextStepTextOf = (point: SetupPoint): string =>
  S.is(SetupPoint.cases.step)(point) ? `side ${point.side} ${point.step}` : 'setup'

const keepsSetup = (report: BenchReport, state: SetupState): boolean =>
  JSON.stringify(report.setupSteps) === JSON.stringify(state.setupSteps) &&
  JSON.stringify(report.withheldPins) === JSON.stringify(state.withheldPins)

const labelsOf = (keys: ReadonlyArray<BenchRunKey>): string => keys.map((key) => key.label).join(',')

const legIncompleteReasonOf = (report: BenchReport): string =>
  S.is(BenchReportOutcome.cases.aborted)(report.outcome) && report.outcome.code === 'leg-incomplete'
    ? report.outcome.reason
    : ''

const unfinishedSamplesArb = Arbitrary.array(Arbitrary.schema(S.Int), { maxLength: BENCH_ORDER.length - 1 })

describe('provisionalReport', () => {
  it.prop(
    '∀prn_FewerRunsFinishedThanTheOrder_≡LegIncompleteNamingTheCountAndTheNextRun',
    { of: [unfinishedSamplesArb], subject: provisionalReport },
    (subject, [samples]) => {
      const finished = finishedOf(samples)
      const count = finished.length
      const decision = Result.getOrThrow(subject(commandOf(finished)))
      const side = BENCH_ORDER[count]
      return S.is(ProvisionalRunNext)(decision) &&
        decision.position === count &&
        decision.side === side &&
        legIncompleteReasonOf(decision.report) ===
          `${count} of 8 runs finished; next step: run ${count + 1} of 8 (side ${side})` &&
        labelsOf(decision.report.runs.map((run) => run.key)) === labelsOf(finished.map((run) => run.key))
    },
  )

  it.prop(
    '∀prs_EveryRunFinished_≡SummarizingNextListingOnlyTheMeasuredRuns',
    {
      of: [
        S.Tuple([S.Int, S.Int, S.Int, S.Int, S.Int, S.Int, S.Int, S.Int]),
        S.Tuple([S.Boolean, S.Boolean, S.Boolean, S.Boolean, S.Boolean, S.Boolean, S.Boolean, S.Boolean]),
      ],
      subject: provisionalReport,
    },
    (subject, [samples, invalidMask]) => {
      const finished = finishedOf(samples, invalidMask)
      const measured = finished.filter(S.is(BenchRunMeasured))
      const decision = Result.getOrThrow(subject(commandOf(finished)))
      return S.is(ProvisionalSummarizeNext)(decision) &&
        legIncompleteReasonOf(decision.report) ===
          '8 of 8 runs finished; next step: summarizing the runs and writing the final report' &&
        labelsOf(decision.report.runs.map((run) => run.key)) === labelsOf(measured.map((run) => run.key))
    },
  )

  it.prop(
    '∀pra_AnyFinishedRunsAndAbortCode_≡AbortedWithItsCodeKeepingTheProvisionalRuns',
    {
      of: [
        Arbitrary.array(Arbitrary.schema(S.Int), { maxLength: BENCH_ORDER.length }),
        Arbitrary.array(Arbitrary.schema(S.Boolean), { maxLength: BENCH_ORDER.length }),
        BenchAbortCode,
        S.String,
      ],
      subject: provisionalReport,
    },
    (subject, [samples, invalidMask, code, reason]) => {
      const finished = finishedOf(samples, invalidMask)
      const provisional = Result.getOrThrow(subject(commandOf(finished)))
      const aborted = Result.getOrThrow(subject(commandOf(finished, { code, reason })))
      return S.is(ProvisionalAborted)(aborted) &&
        S.is(BenchReportOutcome.cases.aborted)(aborted.report.outcome) &&
        aborted.report.outcome.code === code &&
        aborted.report.outcome.reason === reason &&
        labelsOf(aborted.report.runs.map((run) => run.key)) ===
          labelsOf(provisional.report.runs.map((run) => run.key))
    },
  )

  it.prop(
    '∀psn_AnySetupPoint_≡LegIncompleteNamingTheNextSetupStepKeepingStepsAndPins',
    { of: [SetupPoint, S.Array(SetupStep), S.Array(WithheldPins)], subject: provisionalReport },
    (subject, [setup, setupSteps, withheldPins]) => {
      const state = { setup, setupSteps, withheldPins }
      const decision = Result.getOrThrow(subject(commandOf([], null, state)))
      return S.is(ProvisionalSetupNext)(decision) &&
        JSON.stringify(decision.next) === JSON.stringify(setup) &&
        legIncompleteReasonOf(decision.report) ===
          `${setupSteps.length} setup steps measured; next step: ${nextStepTextOf(setup)}` &&
        decision.report.runs.length === 0 &&
        keepsSetup(decision.report, state)
    },
  )

  it.prop(
    '∀psa_AbortAtAnySetupPoint_≡AbortedWithItsCodeKeepingTheMeasuredStepsAndPins',
    {
      of: [SetupPoint, S.Array(SetupStep), S.Array(WithheldPins), BenchAbortCode, S.String],
      subject: provisionalReport,
    },
    (subject, [setup, setupSteps, withheldPins, code, reason]) => {
      const state = { setup, setupSteps, withheldPins }
      const aborted = Result.getOrThrow(subject(commandOf([], { code, reason }, state)))
      return S.is(ProvisionalAborted)(aborted) &&
        S.is(BenchReportOutcome.cases.aborted)(aborted.report.outcome) &&
        aborted.report.outcome.code === code &&
        aborted.report.outcome.reason === reason &&
        keepsSetup(aborted.report, state)
    },
  )
})
