import { Mutant } from '@systemfsoftware/stryker-js-instrumenter'
import { Reporter } from '@systemfsoftware/stryker-js-plugin-interface'
import { describe, it } from '@systemfsoftware/vitest'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import { Arbitrary } from 'effect/unstable/arbitrary'

import {
  ProgressBarTick,
  ProgressChunkSuppressed,
  ProgressLineBreak,
  ProgressReportCommand,
  type ProgressState,
  renderProgressReport,
} from '../render-progress-report.workflow.js'
import { metricsResultFromFiles } from '../reporting/metrics-from-report.js'

const countArb = Arbitrary.schema(S.Int.check(S.isBetween({ minimum: 0, maximum: 1000 })))
const widthArb = Arbitrary.schema(S.Int.check(S.isBetween({ minimum: 1, maximum: 200 })))
const tickArb = Arbitrary.schema(S.Int.check(S.isBetween({ minimum: 1, maximum: 1000 })))
const ticksByMutantIdArb = Arbitrary.schema(S.Record(Mutant.MutantId, S.Int))
const textArb = Arbitrary.schema(S.String)
const nowArb = Arbitrary.schema(S.Int)

const tallyArb = Arbitrary.all({
  survived: countArb,
  timedOut: countArb,
  tested: countArb,
  mutants: countArb,
  total: countArb,
  ticks: countArb,
  ticksByMutantId: ticksByMutantIdArb,
  timing: Arbitrary.all({ net: countArb, overhead: countArb }),
  capabilities: Arbitrary.schema(S.Struct({ reloadEnvironment: S.Boolean })),
  startedAt: countArb,
})

const barArb = Arbitrary.all({
  format: textArb,
  total: countArb,
  curr: countArb,
  width: widthArb,
  complete: textArb,
  incomplete: textArb,
})

const nullableBarArb = Arbitrary.all([Arbitrary.schema(S.Boolean), barArb]).pipe(
  Arbitrary.map(([absent, bar]) => (absent ? null : bar)),
)

const mutantTestedArb = Arbitrary.schema(Reporter.MutantTested)

const planDescriptorArb = Arbitrary.all({
  mutantId: Arbitrary.schema(Mutant.MutantId),
  plan: Arbitrary.schema(S.Literals(['EarlyResult', 'Run'])),
  netTime: countArb,
  reloadEnvironment: Arbitrary.schema(S.Boolean),
})

const planReadyArb = Arbitrary.all({
  total: countArb,
  plans: Arbitrary.array(planDescriptorArb, { maxLength: 4 }),
}).pipe(Arbitrary.map(({ total, plans }) => Reporter.MutationTestingPlanReady.make({ total, plans })))

const dryRunArb = Arbitrary.schema(Reporter.DryRunCompleted)

const sameJson = <Value>(left: Value, right: Value): boolean => JSON.stringify(left) === JSON.stringify(right)

const commandOf = (state: ProgressState, now: number, event: Reporter.ReporterEvent | undefined) =>
  ProgressReportCommand.make({ state, now, event })

const emptyReport = () =>
  Reporter.MutationTestReportReady.make({
    report: { schemaVersion: '1.0', files: {}, thresholds: { high: 100, low: 80, break: null } },
    metrics: metricsResultFromFiles({}),
  })

const finalizeCommandArb = Arbitrary.all([tallyArb, nullableBarArb, nowArb]).pipe(
  Arbitrary.map(([tally, bar, now]) => commandOf({ tally, bar }, now, undefined)),
)

const unknownMutantCommandArb = Arbitrary.all([mutantTestedArb, tallyArb, nullableBarArb, nowArb]).pipe(
  Arbitrary.map(([event, tally, bar, now]) => {
    const ticksByMutantId = Object.fromEntries(
      Object.entries(tally.ticksByMutantId).filter(([id]) => id !== event.id),
    )
    return commandOf({ tally: { ...tally, ticksByMutantId }, bar }, now, event)
  }),
)

const knownMutantCommandArb = Arbitrary.all([
  mutantTestedArb,
  tickArb,
  tallyArb,
  barArb,
  nowArb,
]).pipe(
  Arbitrary.map(([event, ticks, tally, bar, now]) =>
    commandOf(
      { tally: { ...tally, ticksByMutantId: { ...tally.ticksByMutantId, [event.id]: ticks } }, bar },
      now,
      event,
    )
  ),
)

const reportReadyCommandArb = Arbitrary.all([tallyArb, nullableBarArb, nowArb]).pipe(
  Arbitrary.map(([tally, bar, now]) => commandOf({ tally, bar }, now, emptyReport())),
)

const dryRunCommandArb = Arbitrary.all([dryRunArb, tallyArb, nullableBarArb, nowArb]).pipe(
  Arbitrary.map(([event, tally, bar, now]) => commandOf({ tally, bar }, now, event)),
)

const planReadyCommandArb = Arbitrary.all([planReadyArb, tallyArb, nullableBarArb, nowArb]).pipe(
  Arbitrary.map(([event, tally, bar, now]) => commandOf({ tally, bar }, now, event)),
)

describe('renderProgressReport', () => {
  it.prop(
    '∀s_FinalizeState_≡SuppressedUnlessBarIncomplete',
    { of: [finalizeCommandArb], subject: renderProgressReport },
    (subject, [command]) => {
      const result = subject(command)
      if (!Result.isSuccess(result)) {
        return false
      }
      const bar = command.state.bar
      if (bar === null || bar.curr >= bar.total) {
        return S.is(ProgressChunkSuppressed)(result.success) && sameJson(result.success.state, command.state)
      }
      return S.is(ProgressLineBreak)(result.success) &&
        result.success.chunk === '\n' &&
        sameJson(result.success.state, command.state)
    },
  )

  it.prop(
    '∀e_UnknownMutant_≡SuppressedAndStateUnchanged',
    { of: [unknownMutantCommandArb], subject: renderProgressReport },
    (subject, [command]) =>
      Result.match(subject(command), {
        onFailure: () => false,
        onSuccess: (decision) => S.is(ProgressChunkSuppressed)(decision) && sameJson(decision.state, command.state),
      }),
  )

  it.prop(
    '∀e_KnownMutant_≡TickAdvancesTallyAndBar',
    { of: [knownMutantCommandArb], subject: renderProgressReport },
    (subject, [command]) =>
      Result.match(subject(command), {
        onFailure: () => false,
        onSuccess: (decision) => {
          const event = command.event
          const bar = command.state.bar
          if (
            !S.is(Reporter.MutantTested)(event) ||
            !S.is(ProgressBarTick)(decision) ||
            bar === null
          ) {
            return false
          }
          const plannedTicks = command.state.tally.ticksByMutantId[event.id]
          if (typeof plannedTicks !== 'number') {
            return false
          }
          const survived = event.status === 'Survived' ? 1 : 0
          const timedOut = event.status === 'Timeout' ? 1 : 0
          return decision.state.tally.ticks === command.state.tally.ticks + plannedTicks &&
            decision.state.tally.tested === event.completed &&
            decision.state.tally.survived === command.state.tally.survived + survived &&
            decision.state.tally.timedOut === command.state.tally.timedOut + timedOut &&
            decision.state.bar !== null &&
            decision.state.bar.curr === bar.curr + plannedTicks
        },
      }),
  )

  it.prop(
    '∀e_ReportReady_≡SuppressedAndStateUnchanged',
    { of: [reportReadyCommandArb], subject: renderProgressReport },
    (subject, [command]) =>
      Result.match(subject(command), {
        onFailure: () => false,
        onSuccess: (decision) => S.is(ProgressChunkSuppressed)(decision) && sameJson(decision.state, command.state),
      }),
  )

  it.prop(
    '∀e_DryRunCompleted_≡RecordsTimingAndCapabilities',
    { of: [dryRunCommandArb], subject: renderProgressReport },
    (subject, [command]) =>
      Result.match(subject(command), {
        onFailure: () => false,
        onSuccess: (decision) => {
          const event = command.event
          if (!S.is(Reporter.DryRunCompleted)(event)) {
            return false
          }
          return S.is(ProgressChunkSuppressed)(decision) &&
            sameJson(decision.state.tally.timing, event.timing) &&
            decision.state.tally.capabilities.reloadEnvironment === event.capabilities.reloadEnvironment &&
            sameJson(decision.state.bar, command.state.bar) &&
            decision.state.tally.ticks === command.state.tally.ticks
        },
      }),
  )

  it.prop(
    '∀e_PlanReady_≡BarKeyedByRunPlans',
    { of: [planReadyCommandArb], subject: renderProgressReport },
    (subject, [command]) =>
      Result.match(subject(command), {
        onFailure: () => false,
        onSuccess: (decision) => {
          const event = command.event
          const bar = decision.state.bar
          if (!S.is(Reporter.MutationTestingPlanReady)(event) || bar === null) {
            return false
          }
          const runIds = event.plans.filter((plan) => plan.plan === 'Run').map((plan) => plan.mutantId)
          const keys = Object.keys(decision.state.tally.ticksByMutantId)
          const uniqueRunIds = runIds.filter((id, index) => runIds.indexOf(id) === index)
          const total = Object.values(decision.state.tally.ticksByMutantId).reduce((sum, ticks) => sum + ticks, 0)
          return S.is(ProgressChunkSuppressed)(decision) &&
            JSON.stringify([...keys].sort()) === JSON.stringify([...uniqueRunIds].sort()) &&
            decision.state.tally.mutants === keys.length &&
            decision.state.tally.startedAt === command.now &&
            bar.total === total &&
            bar.curr === 0
        },
      }),
  )
})
