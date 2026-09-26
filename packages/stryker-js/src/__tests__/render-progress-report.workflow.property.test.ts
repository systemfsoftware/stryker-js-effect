import { Reporter } from '@systemfsoftware/stryker-js-plugin-interface'
import { describe, it } from '@systemfsoftware/vitest'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import {
  type ProgressBarState,
  ProgressBarTick,
  ProgressChunkSuppressed,
  ProgressLineBreak,
  ProgressReportCommand,
  type ProgressState,
  type ProgressTally,
  renderProgressReport,
} from '../render-progress-report.workflow.js'
import { MetricsResultFromReport } from '../reporting/metrics-from-report.schema.js'

const tallyOf = (over: Partial<ProgressTally> = {}): ProgressTally => ({
  survived: 0,
  timedOut: 0,
  tested: 0,
  mutants: 1,
  total: 10,
  ticks: 0,
  ticksByMutantId: {},
  timing: { net: 0, overhead: 0 },
  capabilities: { reloadEnvironment: false },
  startedAt: 0,
  ...over,
})

const barOf = (over: Partial<ProgressBarState> = {}): ProgressBarState => ({
  format: 'Mutation testing  [:bar] :percent :tested/:mutants',
  total: 10,
  curr: 0,
  width: 10,
  complete: '=',
  incomplete: ' ',
  ...over,
})

const stateOf = (bar: ProgressBarState | null, over: Partial<ProgressTally> = {}): ProgressState => ({
  tally: tallyOf(over),
  bar,
})

const testedMutant = (id: string, completed: number) =>
  Reporter.MutantTested.make({
    id,
    status: 'Killed',
    file: 'src/a.ts',
    location: { start: { line: 1, column: 1 }, end: { line: 1, column: 2 } },
    mutator: 'EqualityOperator',
    replacement: '!=',
    completed,
    total: 10,
  })

const emptyReport = () =>
  Reporter.MutationTestReportReady.make({
    report: { schemaVersion: '1.0', files: {}, thresholds: { high: 100, low: 80 } },
    metrics: MetricsResultFromReport.fromFiles({}),
  })

const commandOf = (state: ProgressState, now: number, event: Reporter.ReporterEvent | undefined) =>
  ProgressReportCommand.make({ state, now, event })

describe('renderProgressReport', () => {
  it.prop(
    '∀n_NullBarFinalize_≡Suppressed',
    { of: [S.Int], subject: renderProgressReport },
    (subject, [now]) => {
      const result = subject(commandOf(stateOf(null), now, undefined))
      return Result.isSuccess(result) && S.is(ProgressChunkSuppressed)(result.success) &&
        result.success.state.bar === null
    },
  )

  it.prop(
    '∀n_IncompleteBarFinalize_≡LineBreak',
    { of: [S.Int], subject: renderProgressReport },
    (subject, [now]) => {
      const result = subject(commandOf(stateOf(barOf({ curr: 1 })), now, undefined))
      return Result.isSuccess(result) && S.is(ProgressLineBreak)(result.success) &&
        result.success.chunk === '\n' &&
        result.success.state.bar?.curr === 1
    },
  )

  it.prop(
    '∀n_CompleteBarFinalize_≡Suppressed',
    { of: [S.Int], subject: renderProgressReport },
    (subject, [now]) => {
      const result = subject(commandOf(stateOf(barOf({ curr: 10, total: 10 })), now, undefined))
      return Result.isSuccess(result) && S.is(ProgressChunkSuppressed)(result.success) &&
        result.success.state.bar?.curr === 10
    },
  )

  it.prop(
    '∀n_UnknownMutant_≡Suppressed',
    { of: [S.Int], subject: renderProgressReport },
    (subject, [now]) => {
      const result = subject(commandOf(stateOf(barOf()), now, testedMutant('unknown', 1)))
      return Result.isSuccess(result) && S.is(ProgressChunkSuppressed)(result.success) &&
        result.success.state.tally.ticks === 0
    },
  )

  it.prop(
    '∀n_KnownMutant_≡TickAdvancesTally',
    { of: [S.Int, S.Int.check(S.isGreaterThanOrEqualTo(1))], subject: renderProgressReport },
    (subject, [now, ticks]) => {
      const state = stateOf(barOf(), { ticksByMutantId: { 'm-1': ticks } })
      const result = subject(commandOf(state, now, testedMutant('m-1', 2)))
      return Result.isSuccess(result) && S.is(ProgressBarTick)(result.success) &&
        result.success.state.tally.ticks === ticks &&
        result.success.state.tally.tested === 2 &&
        result.success.state.bar?.curr === ticks
    },
  )

  it.prop(
    '∀n_ReportReady_≡Suppressed',
    { of: [S.Int], subject: renderProgressReport },
    (subject, [now]) => {
      const result = subject(commandOf(stateOf(barOf()), now, emptyReport()))
      return Result.isSuccess(result) && S.is(ProgressChunkSuppressed)(result.success) &&
        result.success.state.bar?.curr === 0
    },
  )

  it.prop(
    '∀n_DryRunCompleted_≡RecordsTiming',
    { of: [S.Int], subject: renderProgressReport },
    (subject, [now]) => {
      const event = Reporter.DryRunCompleted.make({
        timing: { net: 7, overhead: 3 },
        capabilities: { reloadEnvironment: true },
        testCount: 2,
        tests: [],
      })
      const result = subject(commandOf(stateOf(barOf()), now, event))
      return Result.isSuccess(result) && S.is(ProgressChunkSuppressed)(result.success) &&
        result.success.state.tally.timing.net === 7 &&
        result.success.state.tally.capabilities.reloadEnvironment
    },
  )

  it.prop(
    '∀n_PlanReady_≡BarFromRunPlans',
    { of: [S.Int, S.Int.check(S.isGreaterThanOrEqualTo(1))], subject: renderProgressReport },
    (subject, [now, netTime]) => {
      const event = Reporter.MutationTestingPlanReady.make({
        total: 2,
        plans: [
          { mutantId: 'm-1', plan: 'Run', netTime, reloadEnvironment: false },
          { mutantId: 'm-2', plan: 'EarlyResult', netTime: 99, reloadEnvironment: false },
        ],
      })
      const result = subject(commandOf(stateOf(barOf()), now, event))
      return Result.isSuccess(result) && S.is(ProgressChunkSuppressed)(result.success) &&
        result.success.state.tally.mutants === 1 &&
        result.success.state.bar?.total === netTime &&
        result.success.state.tally.startedAt === now
    },
  )
})
