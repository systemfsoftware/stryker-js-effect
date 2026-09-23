import { Cell, Sandwich } from '@systemfsoftware/effect-cell-types'
import { errorToString } from '@systemfsoftware/stryker-js-instrumenter'
import type { MutantStatus } from '@systemfsoftware/stryker-js-instrumenter'
import type { MutantTested, MutationTestingPlanReady } from '@systemfsoftware/stryker-js-plugin-interface'
import type { ReporterEvent, ReporterFactory } from '@systemfsoftware/stryker-js-plugin-interface'
import { ReporterFailed } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Boolean from 'effect/Boolean'
import type * as Context from 'effect/Context'
import * as Effect from 'effect/Effect'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Ref from 'effect/Ref'
import * as Stream from 'effect/Stream'

import { ReporterOutput } from './reporter-output.service.js'
import {
  renderProgressReport,
  type ProgressBarState,
  type ProgressState,
  type ProgressTally,
} from './render-progress-report.workflow.js'

const failAsProgress = (cause: unknown) =>
  ReporterFailed.make({
    reporterName: 'progress',
    event: 'mutationTestReportReady',
    cause: errorToString(cause),
  })

const PROGRESS_BAR_FORMAT =
  'Mutation testing  [:bar] :percent (elapsed: :et, remaining: :etc) :tested/:mutants Mutants tested (:survived survived, :timedOut timed out)'

const PROGRESS_BAR_WIDTH = 50
const PROGRESS_BAR_COMPLETE = '='
const PROGRESS_BAR_INCOMPLETE = ' '

const emptyTally = (startedAt: number): ProgressTally => ({
  survived: 0,
  timedOut: 0,
  tested: 0,
  mutants: 0,
  total: 0,
  ticks: 0,
  ticksByMutantId: {},
  timing: { net: 0, overhead: 0 },
  capabilities: { reloadEnvironment: false },
  startedAt,
})

const INITIAL_PROGRESS: ProgressState = { tally: emptyTally(0), bar: null }

const TALLY_COUNTED: Record<MutantStatus, { readonly survived: number; readonly timedOut: number }> = {
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

const tallyAfterTest = (tally: ProgressTally, tested: MutantTested, ticks: number): ProgressTally => {
  const counted = TALLY_COUNTED[tested.status]
  return {
    ...tally,
    tested: tested.completed,
    ticks: tally.ticks + ticks,
    survived: tally.survived + counted.survived,
    timedOut: tally.timedOut + counted.timedOut,
  }
}

type ProgressStep = { readonly kind: 'tick' | 'skip'; readonly state: ProgressState }

const planReadyState = (state: ProgressState, planReady: MutationTestingPlanReady, now: number): ProgressState => {
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

const advance = (state: ProgressState, event: ReporterEvent, now: number): ProgressStep =>
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

const readProgressStep = (input: {
  readonly state: ProgressState
  readonly event: ReporterEvent | undefined
}) =>
  Effect.map(Effect.sync(() => performance.now()), (now) =>
    Option.match(Option.fromNullishOr(input.event), {
      onNone: () => ({ _tag: 'ProgressReportCommand' as const, kind: 'finalize' as const, state: input.state, now }),
      onSome: (event) => {
        const step = advance(input.state, event, now)
        return { _tag: 'ProgressReportCommand' as const, kind: step.kind, state: step.state, now }
      },
    }))

export const progressReportCell = Sandwich.named('stryker.report.progress')(readProgressStep)
  .decide(renderProgressReport)
  .write({
    ProgressChunkRendered: (rendered, raw) =>
      Effect.as(
        Effect.flatMap(ReporterOutput, (output) => Effect.ignore(output.write('stdout', [rendered.chunk]))),
        raw.state,
      ),
    ProgressChunkSuppressed: (_suppressed, raw) => Effect.succeed(raw.state),
    CommandRejected: ({ issue }) => Effect.fail(failAsProgress(issue)),
  })

export const progressReporterFactory = (context: Context.Context<ReporterOutput>): ReporterFactory => {
  const step = Cell.provideContext(progressReportCell, context)
  return () => (events) =>
    Effect.gen(function*() {
      const state = yield* Ref.make<ProgressState>(INITIAL_PROGRESS)
      yield* Stream.runForEach(
        Stream.fromAsyncIterable(events, failAsProgress),
        (event) =>
          Effect.gen(function*() {
            const current = yield* Ref.get(state)
            const next = yield* step.run({ state: current, event })
            yield* Ref.set(state, next)
          }),
      )
      yield* step.run({ state: yield* Ref.get(state), event: undefined })
    })
}
