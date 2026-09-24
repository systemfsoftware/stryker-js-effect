import { Workflow } from '@systemfsoftware/effect-cell-types'
import * as Match from 'effect/Match'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

export type DrainedStatus = 'success' | 'failed' | 'skipped'

export interface DrainedTest {
  readonly fullName: string
  readonly file: string
  readonly status: DrainedStatus
  readonly failureMessage: string | undefined
  readonly timeSpentMs: number
}

export const DrainedTestSchema = S.Struct({
  fullName: S.String,
  file: S.String,
  status: S.Literals(['success', 'failed', 'skipped']),
  failureMessage: S.optional(S.String),
  timeSpentMs: S.Finite,
})

const DrainTypeId: unique symbol = Symbol.for('@systemfsoftware/stryker-vm-harness/DrainDecision')
type DrainTypeId = typeof DrainTypeId

export class DrainCompleted extends S.TaggedClass<DrainCompleted>()('DrainCompleted', {
  tests: S.Array(DrainedTestSchema),
}) {
  readonly [DrainTypeId] = DrainTypeId
  readonly kind = 'complete' as const
}

export class DrainTimedOut extends S.TaggedClass<DrainTimedOut>()('DrainTimedOut', {}) {
  readonly [DrainTypeId] = DrainTypeId
  readonly kind = 'timeout' as const
}

export type DrainOutcome = DrainCompleted | DrainTimedOut

export const TestOutcomeSchema = S.Struct({
  failureMessage: S.optional(S.String),
  timeSpentMs: S.optional(S.Finite),
  skipped: S.optional(S.Boolean),
})
export type TestOutcome = S.Schema.Type<typeof TestOutcomeSchema>

export class PlannedTestView extends S.Class<PlannedTestView>('PlannedTestView')({
  fullName: S.String,
  file: S.String,
  seq: S.Finite,
  inverted: S.Boolean,
  skipped: S.Boolean,
  refusedOnly: S.optional(S.Boolean),
}) {}

export class DrainRegistryCommand extends S.TaggedClass<DrainRegistryCommand>()('DrainRegistryCommand', {
  plan: S.Array(PlannedTestView),
  timedOut: S.optional(S.Boolean),
  outcomes: S.optional(S.Record(S.String, TestOutcomeSchema)),
  lateRejections: S.optional(S.Array(S.String)),
}) {}

const LATE_REJECTION_NAME = 'unhandled rejection'

const VITEST_ONLY_REFUSAL =
  '[Vitest] Unexpected .only modifier. Remove it or pass --allowOnly argument to bypass this error'

const drainedRefusedOnly = (planned: PlannedTestView): DrainedTest => ({
  fullName: planned.fullName,
  file: planned.file,
  status: 'failed',
  failureMessage: VITEST_ONLY_REFUSAL,
  timeSpentMs: 0,
})

const drainedSkipped = (planned: PlannedTestView): DrainedTest => ({
  fullName: planned.fullName,
  file: planned.file,
  status: 'skipped',
  failureMessage: undefined,
  timeSpentMs: 0,
})

const drainedRan = (
  planned: PlannedTestView,
  outcomes: Record<string, TestOutcome> | undefined,
): DrainedTest => {
  const outcome = outcomes?.[String(planned.seq)]
  const failureMessage = outcome?.failureMessage
  if (outcome?.skipped === true) {
    return {
      fullName: planned.fullName,
      file: planned.file,
      status: 'skipped',
      failureMessage: undefined,
      timeSpentMs: outcome.timeSpentMs ?? 0,
    }
  }
  const threw = failureMessage !== undefined
  const status: DrainedStatus = Match.value(threw === planned.inverted).pipe(
    Match.when(true, (): DrainedStatus => 'success'),
    Match.when(false, (): DrainedStatus => 'failed'),
    Match.exhaustive,
  )
  const message = Match.value(threw).pipe(
    Match.when(true, () => failureMessage),
    Match.when(false, () =>
      Match.value(planned.inverted).pipe(
        Match.when(true, () => `${planned.fullName} was expected to fail, but passed`),
        Match.when(false, () => undefined),
        Match.exhaustive,
      )),
    Match.exhaustive,
  )
  return {
    fullName: planned.fullName,
    file: planned.file,
    status,
    failureMessage: message,
    timeSpentMs: outcome?.timeSpentMs ?? 0,
  }
}

const drainSingleTest = (
  planned: PlannedTestView,
  outcomes: Record<string, TestOutcome> | undefined,
): DrainedTest => {
  if (planned.refusedOnly === true) {
    return drainedRefusedOnly(planned)
  }
  return Match.value(planned.skipped).pipe(
    Match.when(true, () => drainedSkipped(planned)),
    Match.when(false, () => drainedRan(planned, outcomes)),
    Match.exhaustive,
  )
}

const lateRejectionTests = (lateRejections: readonly string[] | undefined): ReadonlyArray<DrainedTest> =>
  Match.value(lateRejections === undefined || lateRejections.length === 0).pipe(
    Match.when(true, (): ReadonlyArray<DrainedTest> => []),
    Match.when(false, (): ReadonlyArray<DrainedTest> => [{
      fullName: LATE_REJECTION_NAME,
      file: '',
      status: 'failed',
      failureMessage: (lateRejections ?? []).join('\n'),
      timeSpentMs: 0,
    }]),
    Match.exhaustive,
  )

const decideDrain = (command: DrainRegistryCommand): DrainOutcome =>
  Match.value(command.timedOut === true).pipe(
    Match.when(true, () => DrainTimedOut.make({})),
    Match.when(false, () =>
      DrainCompleted.make({
        tests: [
          ...command.plan.map((planned) => drainSingleTest(planned, command.outcomes)),
          ...lateRejectionTests(command.lateRejections),
        ],
      })),
    Match.exhaustive,
  )

export const drainRegistry = Workflow.total(
  DrainRegistryCommand,
  (command: DrainRegistryCommand) => Result.succeed(decideDrain(command)),
)
