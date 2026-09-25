import type { Mutant } from '@systemfsoftware/stryker-js-instrumenter'
import type { Reporter } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Boolean from 'effect/Boolean'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'

import type { ProgressBarState, ProgressState, ProgressTally } from './render-progress-report.workflow.js'

const PROGRESS_BAR_FORMAT =
  'Mutation testing  [:bar] :percent (elapsed: :et, remaining: :etc) :tested/:mutants Mutants tested (:survived survived, :timedOut timed out)'

const PROGRESS_BAR_WIDTH = 50
const PROGRESS_BAR_COMPLETE = '='
const PROGRESS_BAR_INCOMPLETE = ' '

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
  Boolean.match(tally.capabilities.reloadEnvironment === false && plan.reloadEnvironment, {
    onTrue: () => plan.netTime + tally.timing.overhead,
    onFalse: () => plan.netTime,
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

export type ProgressStep = { readonly kind: 'tick' | 'skip' | 'finalize'; readonly state: ProgressState }

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
    bar: {
      format: PROGRESS_BAR_FORMAT,
      total,
      curr: 0,
      width: PROGRESS_BAR_WIDTH,
      complete: PROGRESS_BAR_COMPLETE,
      incomplete: PROGRESS_BAR_INCOMPLETE,
    },
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
      Option.match(Option.fromNullishOr(state.tally.ticksByMutantId[tested.id]), {
        onNone: (): ProgressStep => ({ kind: 'skip', state }),
        onSome: (ticks) => ({
          kind: 'tick' as const,
          state: {
            tally: tallyAfterTest(state.tally, tested, ticks),
            bar: Option.getOrNull(
              Option.map(Option.fromNullishOr(state.bar), (bar) => tickProgressBar(bar, ticks)),
            ),
          },
        }),
      })),
    Match.orElse((): ProgressStep => ({ kind: 'skip', state })),
  )

export const progressStep = (input: {
  readonly state: ProgressState
  readonly event: Reporter.ReporterEvent | undefined
  readonly now: number
}): ProgressStep =>
  Option.match(Option.fromNullishOr(input.event), {
    onNone: (): ProgressStep => ({ kind: 'finalize', state: input.state }),
    onSome: (present) => advance(input.state, present, input.now),
  })

const isComplete = (bar: ProgressBarState): boolean => bar.curr >= bar.total

const secondsBetween = (now: number, startedAt: number): number => Math.floor((now - startedAt) / 1000)

const formatTime = (timeInSeconds: number): string => {
  const hours = Math.floor(timeInSeconds / 3600)
  const minutes = Math.floor((timeInSeconds % 3600) / 60)
  return Match.value(hours > 0).pipe(
    Match.when(true, () => `~${hours}h ${minutes}m`),
    Match.when(false, () =>
      Match.value(minutes > 0).pipe(
        Match.when(true, () => `~${minutes}m`),
        Match.when(false, () => '<1m'),
        Match.exhaustive,
      )),
    Match.exhaustive,
  )
}

const remainingSeconds = (tally: ProgressTally, now: number): number =>
  Math.floor((secondsBetween(now, tally.startedAt) / tally.ticks) * (tally.total - tally.ticks))

const positiveTimeLabel = (remaining: number): string =>
  Match.value(remaining > 0).pipe(
    Match.when(true, () => formatTime(remaining)),
    Match.when(false, () => 'n/a'),
    Match.exhaustive,
  )

const remainingLabel = (tally: ProgressTally, now: number): string => {
  const remaining = remainingSeconds(tally, now)
  return Boolean.match(Number.isFinite(remaining), {
    onTrue: () => positiveTimeLabel(remaining),
    onFalse: () => 'n/a',
  })
}

const progressData = (tally: ProgressTally, now: number): Record<string, string | number> => ({
  survived: tally.survived,
  timedOut: tally.timedOut,
  tested: tally.tested,
  mutants: tally.mutants,
  total: tally.total,
  ticks: tally.ticks,
  et: formatTime(secondsBetween(now, tally.startedAt)),
  etc: remainingLabel(tally, now),
})

const formatBar = (
  bar: ProgressBarState,
  data: Readonly<Record<string, string | number>>,
): string => {
  const ratio = Match.value(bar.total === 0).pipe(
    Match.when(true, () => 0),
    Match.when(false, () => Math.min(bar.curr / bar.total, 1)),
    Match.exhaustive,
  )
  const filled = Math.floor(ratio * bar.width)
  const filledBar = bar.complete.repeat(filled) + bar.incomplete.repeat(bar.width - filled)
  const percent = `${Math.floor(ratio * 100).toString().padStart(3, ' ')}%`
  const printed = bar.format.replace(':bar', filledBar).replace(':percent', percent)
  return Object.entries(data).reduce((out, [key, value]) => out.replaceAll(`:${key}`, String(value)), printed)
}

const lineBreakOf = (complete: boolean): string =>
  Boolean.match(complete, {
    onTrue: () => '\n',
    onFalse: () => '',
  })

export const renderTick = (
  tick: { readonly bar: ProgressBarState; readonly tally: ProgressTally; readonly now: number },
): string => `\r${formatBar(tick.bar, progressData(tick.tally, tick.now))}${lineBreakOf(isComplete(tick.bar))}`
