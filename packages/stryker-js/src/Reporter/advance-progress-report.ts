import type { Mutant, Reporter } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Boolean from 'effect/Boolean'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Record from 'effect/Record'

import {
  isBarComplete,
  type ProgressBarState,
  type ProgressReportCommand,
  type ProgressState,
  type ProgressTally,
} from './progress-report.schema.js'
import { renderProgressLineBreak, renderProgressTick } from './render-progress-report.js'

export interface ProgressStepOutput {
  readonly state: ProgressState
  readonly stdout: readonly string[]
}

const TALLY_COUNTED: Record<Mutant.MutantStatus, { readonly survived: number; readonly timedOut: number }> = {
  Killed: { survived: 0, timedOut: 0 },
  NoCoverage: { survived: 0, timedOut: 0 },
  Ignored: { survived: 0, timedOut: 0 },
  Survived: { survived: 1, timedOut: 0 },
  Timeout: { survived: 0, timedOut: 1 },
  Pending: { survived: 0, timedOut: 0 },
  RuntimeError: { survived: 0, timedOut: 0 },
  CompileError: { survived: 0, timedOut: 0 },
}

const tickProgressBar = (state: ProgressBarState, ticks: number): ProgressBarState => ({
  ...state,
  curr: state.curr + ticks,
})

const ticksFor = (
  plan: { readonly plan: 'EarlyResult' | 'Run'; readonly netTime: number; readonly reloadEnvironment: boolean },
  tally: ProgressTally,
) =>
  Boolean.match(tally.capabilities.reloadEnvironment, {
    onTrue: () => plan.netTime,
    onFalse: () =>
      Boolean.match(plan.reloadEnvironment, {
        onTrue: () => plan.netTime + tally.timing.overhead,
        onFalse: () => plan.netTime,
      }),
  })

const tallyAfterTest = (tally: ProgressTally, tested: Reporter.MutantTested, ticks: number): ProgressTally => {
  const counted = TALLY_COUNTED[tested.status]
  return {
    ...tally,
    tested: tested.completed,
    ticks: tally.ticks + ticks,
    survived: tally.survived + counted.survived,
    timedOut: tally.timedOut + counted.timedOut,
  }
}

type ProgressStep = { readonly kind: 'tick' | 'skip' | 'finalize'; readonly state: ProgressState }

const planReadyState = (
  state: ProgressState,
  planReady: Reporter.MutationTestingPlanReady,
  now: number,
): ProgressState => {
  const ticksByMutantId = Object.fromEntries(
    planReady.plans
      .filter((plan) => plan.plan === 'Run')
      .map((plan) => [plan.mutantId, ticksFor(plan, state.tally)] as const),
  )
  const total = Object.values(ticksByMutantId).reduce((sum, ticks) => sum + ticks, 0)
  return {
    tally: {
      ...state.tally,
      startedAt: now,
      ticksByMutantId,
      mutants: Object.keys(ticksByMutantId).length,
      total,
    },
    bar: { total, curr: 0 },
  }
}

const advance = (state: ProgressState, event: Reporter.ReporterEvent, now: number): ProgressStep =>
  Match.value(event).pipe(
    Match.tag('dryRunCompleted', (dryRun) => ({
      kind: 'skip' as const,
      state: {
        ...state,
        tally: {
          ...state.tally,
          timing: dryRun.timing,
          capabilities: { reloadEnvironment: dryRun.capabilities.reloadEnvironment },
        },
      },
    })),
    Match.tag('mutationTestingPlanReady', (planReady) => ({
      kind: 'skip' as const,
      state: planReadyState(state, planReady, now),
    })),
    Match.tag('mutantTested', (tested) =>
      Option.match(Record.get(state.tally.ticksByMutantId, tested.id), {
        onNone: (): ProgressStep => ({ kind: 'skip', state }),
        onSome: (ticks) => ({
          kind: 'tick' as const,
          state: {
            tally: tallyAfterTest(state.tally, tested, ticks),
            bar: Option.getOrNull(Option.map(Option.fromNullishOr(state.bar), (bar) => tickProgressBar(bar, ticks))),
          },
        }),
      })),
    Match.tag('mutationTestReportReady', (): ProgressStep => ({ kind: 'skip', state })),
    Match.exhaustive,
  )

const progressStep = (
  state: ProgressState,
  event: Reporter.ReporterEvent | undefined,
  now: number,
): ProgressStep =>
  Option.match(Option.fromNullishOr(event), {
    onNone: (): ProgressStep => ({ kind: 'finalize', state }),
    onSome: (present) => advance(state, present, now),
  })

const recorded = (state: ProgressState): ProgressStepOutput => ({ state, stdout: [] })

export const advanceProgress = (command: ProgressReportCommand): ProgressStepOutput => {
  const step = progressStep(command.state, command.event, command.now)
  return Match.value(step.kind).pipe(
    Match.when('finalize', () =>
      Option.match(Option.fromNullishOr(step.state.bar), {
        onNone: () => recorded(step.state),
        onSome: (bar) =>
          Boolean.match(isBarComplete(bar), {
            onTrue: () => recorded(step.state),
            onFalse: (): ProgressStepOutput => ({ state: step.state, stdout: [renderProgressLineBreak()] }),
          }),
      })),
    Match.when('skip', () => recorded(step.state)),
    Match.when('tick', () =>
      Option.match(Option.fromNullishOr(step.state.bar), {
        onNone: () => recorded(step.state),
        onSome: (bar): ProgressStepOutput => ({
          state: step.state,
          stdout: [renderProgressTick({ bar, tally: step.state.tally, now: command.now })],
        }),
      })),
    Match.exhaustive,
  )
}

if (import.meta.vitest !== void 0) {
  const { it } = await import('@systemfsoftware/vitest')
  const { Reporter } = await import('@systemfsoftware/stryker-js-plugin-interface')
  const S = await import('effect/Schema')
  const { ProgressStateSchema } = await import('./progress-report.schema.js')

  it.prop(
    '∀spn_PlanReady_≡FreshConsistentProgressBar',
    {
      of: [ProgressStateSchema, Reporter.MutationTestingPlanReady, S.Finite],
      subject: planReadyState,
    },
    (subject, [state, event, now]) => {
      const output = subject(state, event, now)
      const bar = output.bar
      return bar !== null && [
        bar.curr === 0,
        bar.total === output.tally.total,
        Number.isFinite(bar.total),
        output.tally.mutants === event.plans.filter((plan) => plan.plan === 'Run').length,
      ].every((holds) => holds)
    },
  )
}
