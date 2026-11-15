import { Workflow } from '@systemfsoftware/effect-cell-types'
import { Mutant } from '@systemfsoftware/stryker-js-plugin-interface'
import { Report, Reporter } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Boolean from 'effect/Boolean'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Record from 'effect/Record'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

const ProgressReportTypeId: unique symbol = Symbol.for('@systemfsoftware/stryker-js/ProgressReport')
type ProgressReportTypeId = typeof ProgressReportTypeId

const ProgressCapabilitiesSchema = S.Struct({ reloadEnvironment: S.Boolean })

export const ProgressTallySchema = S.Struct({
  survived: Report.NonNegativeInt,
  timedOut: Report.NonNegativeInt,
  tested: Report.NonNegativeInt,
  mutants: Report.NonNegativeInt,
  total: Report.NonNegativeFinite,
  ticks: Report.NonNegativeFinite,
  ticksByMutantId: S.Record(Mutant.MutantId, Report.NonNegativeFinite),
  timing: Reporter.RunTimingSchema,
  capabilities: ProgressCapabilitiesSchema,
  startedAt: S.Finite,
})
export type ProgressTally = typeof ProgressTallySchema.Type

export const ProgressBarStateSchema = S.Struct({
  total: Report.NonNegativeFinite,
  curr: Report.NonNegativeFinite,
})
export type ProgressBarState = typeof ProgressBarStateSchema.Type

export const ProgressStateSchema = S.Struct({
  tally: ProgressTallySchema,
  bar: S.NullOr(ProgressBarStateSchema),
})
export type ProgressState = typeof ProgressStateSchema.Type

export class ProgressReportCommand
  extends S.TaggedClass<ProgressReportCommand, { readonly brand: unique symbol }>()('ProgressReportCommand', {
    state: ProgressStateSchema,
    event: S.UndefinedOr(Reporter.ReporterEventUnion),
    now: S.Finite,
  })
{
  static readonly [Workflow.InstrumentationBrand] = {} as const
}

export class ProgressBarTicked
  extends S.TaggedClass<ProgressBarTicked, { readonly brand: unique symbol }>()('ProgressBarTicked', {
    bar: ProgressBarStateSchema,
    state: ProgressStateSchema,
  })
{
  readonly [ProgressReportTypeId] = ProgressReportTypeId
}

export class ProgressBarLeftIncomplete
  extends S.TaggedClass<ProgressBarLeftIncomplete, { readonly brand: unique symbol }>()('ProgressBarLeftIncomplete', {
    state: ProgressStateSchema,
  })
{
  readonly [ProgressReportTypeId] = ProgressReportTypeId
}

export class ProgressRecorded
  extends S.TaggedClass<ProgressRecorded, { readonly brand: unique symbol }>()('ProgressRecorded', {
    state: ProgressStateSchema,
  })
{
  readonly [ProgressReportTypeId] = ProgressReportTypeId
}

export const ProgressReportDecision = S.Union([ProgressBarTicked, ProgressBarLeftIncomplete, ProgressRecorded])
export type ProgressReportDecision = typeof ProgressReportDecision.Type

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

const isComplete = (bar: ProgressBarState): boolean => bar.curr >= bar.total

const progressDecisionOf = (command: ProgressReportCommand): ProgressReportDecision => {
  const step = progressStep(command.state, command.event, command.now)
  return Match.value(step.kind).pipe(
    Match.when('finalize', () =>
      Option.match(Option.fromNullishOr(step.state.bar), {
        onNone: () => ProgressRecorded.make({ state: step.state }),
        onSome: (bar) =>
          Boolean.match(isComplete(bar), {
            onTrue: () => ProgressRecorded.make({ state: step.state }),
            onFalse: () => ProgressBarLeftIncomplete.make({ state: step.state }),
          }),
      })),
    Match.when('skip', () => ProgressRecorded.make({ state: step.state })),
    Match.when('tick', () =>
      Option.match(Option.fromNullishOr(step.state.bar), {
        onNone: () => ProgressRecorded.make({ state: step.state }),
        onSome: (bar) => ProgressBarTicked.make({ bar, state: step.state }),
      })),
    Match.exhaustive,
  )
}

export const advanceProgressReport = Workflow.make({
  command: ProgressReportCommand,
  decision: ProgressReportDecision,
  error: S.Never,
  decide: (command): Result.Result<ProgressReportDecision, never> => Result.succeed(progressDecisionOf(command)),
})
