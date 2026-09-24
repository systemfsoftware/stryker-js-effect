import { Workflow } from '@systemfsoftware/effect-cell-types'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
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
  lateRejections: S.optional(S.String.pipe(S.Array)),
}) {
  static readonly [Workflow.InstrumentationBrand] = {} as const
}

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

const outcomeOf = (outcomes: Record<string, TestOutcome> | undefined, seq: number): TestOutcome | undefined =>
  Option.getOrUndefined(
    Option.flatMap(
      Option.fromNullishOr(outcomes),
      (present) => Option.fromNullishOr(present[String(seq)]),
    ),
  )

const failureMessageOf = (outcome: TestOutcome | undefined): string | undefined =>
  Option.getOrUndefined(
    Option.flatMap(Option.fromNullishOr(outcome), (present) => Option.fromNullishOr(present.failureMessage)),
  )

const timeSpentOf = (outcome: TestOutcome | undefined): number =>
  Option.getOrElse(
    Option.flatMap(Option.fromNullishOr(outcome), (present) => Option.fromNullishOr(present.timeSpentMs)),
    () => 0,
  )

const invertedFailureMessage = (planned: PlannedTestView): string | undefined =>
  Match.value(planned.inverted).pipe(
    Match.when(true, () => `${planned.fullName} was expected to fail, but passed`),
    Match.when(false, () => undefined),
    Match.exhaustive,
  )

const drainedRan = (
  planned: PlannedTestView,
  outcomes: Record<string, TestOutcome> | undefined,
): DrainedTest => {
  const outcome = outcomeOf(outcomes, planned.seq)
  const failureMessage = failureMessageOf(outcome)
  if (outcome?.skipped === true) {
    return {
      fullName: planned.fullName,
      file: planned.file,
      status: 'skipped',
      failureMessage: undefined,
      timeSpentMs: timeSpentOf(outcome),
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
    Match.when(false, () => invertedFailureMessage(planned)),
    Match.exhaustive,
  )
  return {
    fullName: planned.fullName,
    file: planned.file,
    status,
    failureMessage: message,
    timeSpentMs: timeSpentOf(outcome),
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

const lateRejectionsOf = (lateRejections: readonly string[] | undefined): ReadonlyArray<string> =>
  Option.getOrElse(Option.fromNullishOr(lateRejections), () => [])

const isEmptyLateRejections = (lateRejections: readonly string[] | undefined): boolean =>
  Option.match(Option.fromNullishOr(lateRejections), {
    onNone: () => true,
    onSome: (present) => present.length === 0,
  })

const lateRejectionTest = (lateRejections: readonly string[] | undefined): DrainedTest => ({
  fullName: LATE_REJECTION_NAME,
  file: '',
  status: 'failed',
  failureMessage: lateRejectionsOf(lateRejections).join('\n'),
  timeSpentMs: 0,
})

const lateRejectionTests = (lateRejections: readonly string[] | undefined): ReadonlyArray<DrainedTest> =>
  Match.value(isEmptyLateRejections(lateRejections)).pipe(
    Match.when(true, (): ReadonlyArray<DrainedTest> => []),
    Match.when(false, () => [lateRejectionTest(lateRejections)]),
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

export const drainRegistry = Workflow.make({
  command: DrainRegistryCommand,
  decision: S.Union([DrainCompleted, DrainTimedOut]),
  error: S.Never,
  decide: (command: DrainRegistryCommand) => Result.succeed(decideDrain(command)),
})
