import { Workflow } from '@systemfsoftware/effect-cell-types'
import { TestRunner } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

export class DryRunObservation extends S.TaggedClass<DryRunObservation>()('DryRunObservation', {
  dryRunResult: TestRunner.DryRunResultSchema,
  allowEmpty: S.Boolean,
}) {
  static readonly [Workflow.InstrumentationBrand] = {} as const
}

const FailureSummarySchema = S.Struct({ name: S.String, failureMessage: S.String })

const DryRunObservationDecisionTypeId: unique symbol = Symbol.for(
  '@systemfsoftware/stryker-js/DryRunObservationDecision',
)
type DryRunObservationDecisionTypeId = typeof DryRunObservationDecisionTypeId

export class DryRunObservedComplete extends S.TaggedClass<DryRunObservedComplete>()('DryRunObservedComplete', {
  testCount: S.Finite,
  failedTestCount: S.Finite,
  failedTests: S.Array(FailureSummarySchema),
}) {
  readonly [DryRunObservationDecisionTypeId] = DryRunObservationDecisionTypeId
}

export class DryRunObservedFailed extends S.TaggedClass<DryRunObservedFailed>()('DryRunObservedFailed', {
  errorMessage: S.String,
}) {
  readonly [DryRunObservationDecisionTypeId] = DryRunObservationDecisionTypeId
}

export class DryRunObservedTimedOut extends S.TaggedClass<DryRunObservedTimedOut>()('DryRunObservedTimedOut', {
  reason: S.optional(S.String),
}) {
  readonly [DryRunObservationDecisionTypeId] = DryRunObservationDecisionTypeId
}

export type DryRunObservationDecision = DryRunObservedComplete | DryRunObservedFailed | DryRunObservedTimedOut

const failedTestSummariesOf = (
  tests: readonly TestRunner.TestResult[],
): readonly (typeof FailureSummarySchema.Type)[] =>
  tests
    .filter((test): test is TestRunner.FailedTestResult => test.status === 'failed')
    .map((test) => ({ name: test.name, failureMessage: test.failureMessage }))

const decide = (command: DryRunObservation): Result.Result<DryRunObservationDecision, never> =>
  Match.value(command.dryRunResult).pipe(
    Match.discriminator('status')('complete', (complete) =>
      Result.succeed(
        DryRunObservedComplete.make({
          testCount: complete.tests.length,
          failedTestCount: complete.tests.filter((test) => test.status === 'failed').length,
          failedTests: failedTestSummariesOf(complete.tests),
        }),
      )),
    Match.discriminator('status')(
      'error',
      (failed) => Result.succeed(DryRunObservedFailed.make({ errorMessage: failed.errorMessage })),
    ),
    Match.discriminator('status')('timeout', (timedOut) =>
      Result.succeed(
        DryRunObservedTimedOut.make(
          Option.match(Option.fromNullishOr(timedOut.reason), {
            onNone: () => ({}),
            onSome: (reason) => ({ reason }),
          }),
        ),
      )),
    Match.exhaustive,
  )

export const interpretDryRunObservation = Workflow.make({
  command: DryRunObservation,
  decision: S.Union([DryRunObservedComplete, DryRunObservedFailed, DryRunObservedTimedOut]),
  error: S.Never,
  decide,
})
