import { Workflow } from '@systemfsoftware/effect-cell-types'
import { Mutant } from '@systemfsoftware/stryker-js-instrumenter'
import { Reporter } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Boolean from 'effect/Boolean'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Record from 'effect/Record'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

const ProgressReportTypeId: unique symbol = Symbol.for('@systemfsoftware/stryker-js/ProgressReport')
type ProgressReportTypeId = typeof ProgressReportTypeId

const ProgressTimingSchema = S.Struct({ net: S.Finite, overhead: S.Finite })

const ProgressCapabilitiesSchema = S.Struct({ reloadEnvironment: S.Boolean })

export const ProgressTallySchema = S.Struct({
  survived: S.Finite,
  timedOut: S.Finite,
  tested: S.Finite,
  mutants: S.Finite,
  total: S.Finite,
  ticks: S.Finite,
  ticksByMutantId: S.Record(Mutant.MutantId, S.Finite),
  timing: ProgressTimingSchema,
  capabilities: ProgressCapabilitiesSchema,
  startedAt: S.Finite,
})
export type ProgressTally = typeof ProgressTallySchema.Type

export const ProgressBarStateSchema = S.Struct({
  format: S.String,
  total: S.Finite,
  curr: S.Finite,
  width: S.Finite,
  complete: S.String,
  incomplete: S.String,
})
export type ProgressBarState = typeof ProgressBarStateSchema.Type

export const ProgressStateSchema = S.Struct({
  tally: ProgressTallySchema,
  bar: S.NullOr(ProgressBarStateSchema),
})
export type ProgressState = typeof ProgressStateSchema.Type

export class ProgressReportCommand extends S.TaggedClass<ProgressReportCommand>()('ProgressReportCommand', {
  state: ProgressStateSchema,
  event: S.UndefinedOr(Reporter.ReporterEventUnion),
  now: S.Finite,
}) {
  static readonly [Workflow.InstrumentationBrand] = { now: 'stryker.report.rendered' } as const
}

export class ProgressBarTick extends S.TaggedClass<ProgressBarTick>()('ProgressBarTick', {
  chunk: S.String,
  state: ProgressStateSchema,
}) {
  readonly [ProgressReportTypeId] = ProgressReportTypeId
}

export class ProgressLineBreak extends S.TaggedClass<ProgressLineBreak>()('ProgressLineBreak', {
  chunk: S.String,
  state: ProgressStateSchema,
}) {
  readonly [ProgressReportTypeId] = ProgressReportTypeId
}

export class ProgressChunkSuppressed extends S.TaggedClass<ProgressChunkSuppressed>()('ProgressChunkSuppressed', {
  state: ProgressStateSchema,
}) {
  readonly [ProgressReportTypeId] = ProgressReportTypeId
}

export const ProgressReportDecision = S.Union([ProgressBarTick, ProgressLineBreak, ProgressChunkSuppressed])
export type ProgressReportDecision = typeof ProgressReportDecision.Type

const PROGRESS_BAR_FORMAT =
  'Mutation testing  [:bar] :percent (elapsed: :et, remaining: :etc) :tested/:mutants Mutants tested (:survived survived, :timedOut timed out)'

const PROGRESS_BAR_WIDTH = 50
const PROGRESS_BAR_COMPLETE = '='
const PROGRESS_BAR_INCOMPLETE = ' '

const floor = Math.floor
const min = Math.min

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

const isComplete = (bar: ProgressBarState): boolean => bar.curr >= bar.total

const secondsBetween = (now: number, startedAt: number): number => floor((now - startedAt) / 1000)

const formatTime = (timeInSeconds: number): string => {
  const hours = floor(timeInSeconds / 3600)
  const minutes = floor((timeInSeconds % 3600) / 60)
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
  floor((secondsBetween(now, tally.startedAt) / tally.ticks) * (tally.total - tally.ticks))

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

const formatBar = (bar: ProgressBarState, data: Readonly<Record<string, string | number>>): string => {
  const ratio = Match.value(bar.total === 0).pipe(
    Match.when(true, () => 0),
    Match.when(false, () => min(bar.curr / bar.total, 1)),
    Match.exhaustive,
  )
  const filled = floor(ratio * bar.width)
  const filledBar = bar.complete.repeat(filled) + bar.incomplete.repeat(bar.width - filled)
  const percent = `${floor(ratio * 100).toString().padStart(3, ' ')}%`
  const printed = bar.format.replace(':bar', filledBar).replace(':percent', percent)
  return Object.entries(data).reduce((out, [key, value]) => out.replaceAll(`:${key}`, String(value)), printed)
}

const renderTick = (
  tick: { readonly bar: ProgressBarState; readonly tally: ProgressTally; readonly now: number },
): string =>
  `\r${formatBar(tick.bar, progressData(tick.tally, tick.now))}${
    Boolean.match(isComplete(tick.bar), { onTrue: () => '\n', onFalse: () => '' })
  }`

const renderDecisionOf = (command: ProgressReportCommand): ProgressReportDecision => {
  const step = progressStep(command.state, command.event, command.now)
  return Match.value(step.kind).pipe(
    Match.when('finalize', () =>
      Option.match(Option.fromNullishOr(step.state.bar), {
        onNone: () => ProgressChunkSuppressed.make({ state: step.state }),
        onSome: (bar) =>
          Boolean.match(isComplete(bar), {
            onTrue: () => ProgressChunkSuppressed.make({ state: step.state }),
            onFalse: () => ProgressLineBreak.make({ chunk: '\n', state: step.state }),
          }),
      })),
    Match.when('skip', () => ProgressChunkSuppressed.make({ state: step.state })),
    Match.when('tick', () =>
      Option.match(Option.fromNullishOr(step.state.bar), {
        onNone: () => ProgressChunkSuppressed.make({ state: step.state }),
        onSome: (bar) =>
          ProgressBarTick.make({
            chunk: renderTick({ bar, tally: step.state.tally, now: command.now }),
            state: step.state,
          }),
      })),
    Match.exhaustive,
  )
}

export const renderProgressReport = Workflow.make({
  command: ProgressReportCommand,
  decision: ProgressReportDecision,
  error: S.Never,
  decide: (command): Result.Result<ProgressReportDecision, never> => Result.succeed(renderDecisionOf(command)),
})
