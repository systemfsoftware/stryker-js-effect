import { Workflow } from '@systemfsoftware/effect-cell-types'
import * as Match from 'effect/Match'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import { type PlannedTest, planRun, type TestRegistry } from './registry.js'

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
})
export type TestOutcome = S.Schema.Type<typeof TestOutcomeSchema>

export class DrainRegistryCommand extends S.TaggedClass<DrainRegistryCommand>()('DrainRegistryCommand', {
  registry: S.optional(S.Unknown),
  plan: S.optional(S.Array(S.Unknown)),
  timedOut: S.optional(S.Boolean),
  outcomes: S.optional(S.Record(S.String, TestOutcomeSchema)),
  lateRejections: S.optional(S.Array(S.String)),
}) {}

const resolvePlan = (command: DrainRegistryCommand): ReadonlyArray<PlannedTest> =>
  Match.value(command.plan !== undefined).pipe(
    Match.when(true, () => command.plan as ReadonlyArray<PlannedTest>),
    Match.when(false, () =>
      Match.value(command.registry !== undefined).pipe(
        Match.when(true, () => planRun(command.registry as TestRegistry)),
        Match.when(false, () => [] as ReadonlyArray<PlannedTest>),
        Match.exhaustive,
      )),
    Match.exhaustive,
  )

const drainSingleTest = (
  planned: PlannedTest,
  outcomes: Record<string, TestOutcome> | undefined,
): DrainedTest =>
  Match.value(planned.skipped).pipe(
    Match.when(true, (): DrainedTest => ({
      fullName: planned.fullName,
      file: planned.test.file,
      status: 'skipped',
      failureMessage: undefined,
      timeSpentMs: 0,
    })),
    Match.when(false, (): DrainedTest => {
      const outcome = outcomes?.[String(planned.test.seq)]
      const failureMessage = outcome?.failureMessage
      const threw = failureMessage !== undefined
      const status: DrainedStatus = Match.value(threw === planned.test.inverted).pipe(
        Match.when(true, (): DrainedStatus => 'success'),
        Match.when(false, (): DrainedStatus => 'failed'),
        Match.exhaustive,
      )
      const message = Match.value(threw).pipe(
        Match.when(true, () => failureMessage),
        Match.when(false, () =>
          Match.value(planned.test.inverted).pipe(
            Match.when(true, () => `${planned.fullName} was expected to fail, but passed`),
            Match.when(false, () => undefined),
            Match.exhaustive,
          )),
        Match.exhaustive,
      )
      return {
        fullName: planned.fullName,
        file: planned.test.file,
        status,
        failureMessage: message,
        timeSpentMs: outcome?.timeSpentMs ?? 0,
      }
    }),
    Match.exhaustive,
  )

const decideDrain = (command: DrainRegistryCommand): DrainOutcome =>
  Match.value(command.timedOut === true).pipe(
    Match.when(true, () => DrainTimedOut.make({})),
    Match.when(false, () => {
      const plan = resolvePlan(command)
      const drained: DrainedTest[] = plan.map((planned) => drainSingleTest(planned, command.outcomes))
      const lateRejections = command.lateRejections
      if (lateRejections !== undefined && lateRejections.length > 0) {
        drained.push({
          fullName: 'unhandled rejection',
          file: '',
          status: 'failed',
          failureMessage: lateRejections.join('\n'),
          timeSpentMs: 0,
        })
      }
      return DrainCompleted.make({ tests: drained })
    }),
    Match.exhaustive,
  )

export const drainRegistry = Workflow.total(
  DrainRegistryCommand,
  (command: DrainRegistryCommand) => Result.succeed(decideDrain(command)),
)
