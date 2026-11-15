import { Reporter } from '@systemfsoftware/stryker-js-plugin-interface'
import { describe, it } from '@systemfsoftware/vitest'
import * as Arbitrary from 'effect/Arbitrary'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import {
  advanceProgressReport,
  ProgressBarLeftIncomplete,
  ProgressBarStateSchema,
  ProgressBarTicked,
  ProgressRecorded,
  ProgressReportCommand,
  ProgressStateSchema,
  ProgressTallySchema,
} from '../Reporter/advance-progress-report.workflow.js'

const offsetArb = Arbitrary.schema(S.Literals([-2, -1, 0, 1, 2]))

const finalizeArb = Arbitrary.all([
  Arbitrary.schema(ProgressStateSchema),
  offsetArb,
  Arbitrary.schema(ProgressReportCommand.fields.now),
])

describe('advanceProgressReport', () => {
  it.prop(
    '∀s_Finalize_≡LeftIncompleteIffBarUnfinished',
    {
      of: [finalizeArb],
      subject: advanceProgressReport,
      cover: {
        noBar: [([state]) => state.bar === null, 0.05],
        belowTotal: [([state, offset]) => state.bar !== null && offset < 0, 0.05],
        atTotal: [([state, offset]) => state.bar !== null && offset === 0, 0.05],
        pastTotal: [([state, offset]) => state.bar !== null && offset > 0, 0.05],
      },
    },
    (subject, [[drawn, offset, now]]) => {
      const state = drawn.bar === null
        ? drawn
        : { ...drawn, bar: { total: drawn.bar.total, curr: drawn.bar.total + offset } }
      return Result.match(subject(ProgressReportCommand.make({ state, now, event: undefined })), {
        onFailure: () => false,
        onSuccess: (decision) => {
          const unfinished = state.bar !== null && state.bar.curr < state.bar.total
          const tagged = unfinished ? S.is(ProgressBarLeftIncomplete)(decision) : S.is(ProgressRecorded)(decision)
          return tagged && S.toEquivalence(ProgressStateSchema)(decision.state, state)
        },
      })
    },
  )

  it.prop(
    '∀e_UnknownMutant_≡RecordedAndStateUnchanged',
    {
      of: [Reporter.MutantTested, ProgressStateSchema, ProgressReportCommand.fields.now],
      subject: advanceProgressReport,
    },
    (subject, [event, drawn, now]) => {
      const ticksByMutantId = Object.fromEntries(
        Object.entries(drawn.tally.ticksByMutantId).filter(([id]) => id !== event.id),
      )
      const state = { ...drawn, tally: { ...drawn.tally, ticksByMutantId } }
      return Result.match(subject(ProgressReportCommand.make({ state, now, event })), {
        onFailure: () => false,
        onSuccess: (decision) =>
          S.is(ProgressRecorded)(decision) && S.toEquivalence(ProgressStateSchema)(decision.state, state),
      })
    },
  )

  it.prop(
    '∀e_KnownMutant_≡TickAdvancesTallyAndBar',
    {
      of: [
        Arbitrary.all([
          Arbitrary.schema(Reporter.MutantTested),
          Arbitrary.schema(ProgressStateSchema),
          Arbitrary.schema(ProgressTallySchema.fields.ticks),
          Arbitrary.schema(ProgressReportCommand.fields.now),
        ]),
      ],
      subject: advanceProgressReport,
      cover: {
        withBar: [([, state]) => state.bar !== null, 0.05],
        withoutBar: [([, state]) => state.bar === null, 0.05],
        survived: [([event]) => event.status === 'Survived', 0.05],
        timedOut: [([event]) => event.status === 'Timeout', 0.05],
      },
    },
    (subject, [[event, drawn, planned, now]]) => {
      const tally = { ...drawn.tally, ticksByMutantId: { ...drawn.tally.ticksByMutantId, [event.id]: planned } }
      const state = { ...drawn, tally }
      const expectedTally = {
        ...tally,
        tested: event.completed,
        ticks: tally.ticks + planned,
        survived: tally.survived + (event.status === 'Survived' ? 1 : 0),
        timedOut: tally.timedOut + (event.status === 'Timeout' ? 1 : 0),
      }
      const bar = state.bar
      return Result.match(subject(ProgressReportCommand.make({ state, now, event })), {
        onFailure: () => false,
        onSuccess: (decision) => {
          if (bar === null) {
            return S.is(ProgressRecorded)(decision) &&
              S.toEquivalence(ProgressStateSchema)(decision.state, { tally: expectedTally, bar: null })
          }
          const expectedBar = { total: bar.total, curr: bar.curr + planned }
          return S.is(ProgressBarTicked)(decision) &&
            S.toEquivalence(ProgressBarStateSchema)(decision.bar, expectedBar) &&
            S.toEquivalence(ProgressStateSchema)(decision.state, { tally: expectedTally, bar: expectedBar })
        },
      })
    },
  )

  it.prop(
    '∀e_ReportReady_≡RecordedAndStateUnchanged',
    {
      of: [Reporter.MutationTestReportReady, ProgressStateSchema, ProgressReportCommand.fields.now],
      subject: advanceProgressReport,
    },
    (subject, [event, state, now]) =>
      Result.match(subject(ProgressReportCommand.make({ state, now, event })), {
        onFailure: () => false,
        onSuccess: (decision) =>
          S.is(ProgressRecorded)(decision) && S.toEquivalence(ProgressStateSchema)(decision.state, state),
      }),
  )

  it.prop(
    '∀e_DryRunCompleted_≡RecordsTimingAndCapabilities',
    {
      of: [Reporter.DryRunCompleted, ProgressStateSchema, ProgressReportCommand.fields.now],
      subject: advanceProgressReport,
    },
    (subject, [event, state, now]) => {
      const expected = {
        ...state,
        tally: {
          ...state.tally,
          timing: event.timing,
          capabilities: { reloadEnvironment: event.capabilities.reloadEnvironment },
        },
      }
      return Result.match(subject(ProgressReportCommand.make({ state, now, event })), {
        onFailure: () => false,
        onSuccess: (decision) =>
          S.is(ProgressRecorded)(decision) && S.toEquivalence(ProgressStateSchema)(decision.state, expected),
      })
    },
  )

  it.prop(
    '∀e_PlanReady_≡BarKeyedByRunPlans',
    {
      of: [
        Arbitrary.all([
          Arbitrary.schema(Reporter.MutationTestingPlanReady),
          Arbitrary.schema(ProgressStateSchema),
          Arbitrary.schema(ProgressReportCommand.fields.now),
        ]),
      ],
      subject: advanceProgressReport,
      cover: {
        runPlan: [([event]) => event.plans.some((plan) => plan.plan === 'Run'), 0.05],
        earlyResultPlan: [([event]) => event.plans.some((plan) => plan.plan === 'EarlyResult'), 0.05],
        overheadCharged: [
          ([event, state]) =>
            !state.tally.capabilities.reloadEnvironment &&
            event.plans.some((plan) => plan.plan === 'Run' && plan.reloadEnvironment),
          0.05,
        ],
        pluginReloads: [
          ([event, state]) =>
            state.tally.capabilities.reloadEnvironment &&
            event.plans.some((plan) => plan.plan === 'Run' && plan.reloadEnvironment),
          0.05,
        ],
      },
    },
    (subject, [[event, state, now]]) => {
      const tally = state.tally
      const overhead = tally.capabilities.reloadEnvironment ? 0 : tally.timing.overhead
      const planned = new Map(
        event.plans
          .filter((plan) => plan.plan === 'Run')
          .map((plan) => [plan.mutantId, plan.reloadEnvironment ? plan.netTime + overhead : plan.netTime]),
      )
      const total = [...planned.values()].reduce((sum, ticks) => sum + ticks, 0)
      const expected = {
        tally: { ...tally, startedAt: now, ticksByMutantId: Object.fromEntries(planned), mutants: planned.size, total },
        bar: { total, curr: 0 },
      }
      return Result.match(subject(ProgressReportCommand.make({ state, now, event })), {
        onFailure: () => false,
        onSuccess: (decision) =>
          S.is(ProgressRecorded)(decision) && S.toEquivalence(ProgressStateSchema)(decision.state, expected),
      })
    },
  )
})
