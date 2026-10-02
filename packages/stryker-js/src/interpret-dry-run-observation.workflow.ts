import { Workflow } from '@systemfsoftware/effect-cell-types'
import { FailureRecord } from '@systemfsoftware/stryker-js-cli-contract'
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

const DryRunObservationDecisionTypeId: unique symbol = Symbol.for(
  '@systemfsoftware/stryker-js/DryRunObservationDecision',
)
type DryRunObservationDecisionTypeId = typeof DryRunObservationDecisionTypeId

export class DryRunObservedComplete extends S.TaggedClass<DryRunObservedComplete>()('DryRunObservedComplete', {
  testCount: S.Finite,
  failedTestCount: S.Finite,
  failedTests: S.Array(FailureRecord.FailedTestEvidence),
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

const orNullOf = <A>(value: A | undefined): A | null => Option.fromUndefinedOr(value).pipe(Option.getOrNull)

const failedTestEvidenceOf = (test: TestRunner.FailedTestResult): FailureRecord.FailedTestEvidence => ({
  id: test.id,
  name: test.name,
  file: orNullOf(test.fileName),
  location: orNullOf(test.location),
  message: test.failureMessage,
  stack: orNullOf(test.stack),
})

const failedTestEvidencesOf = (
  tests: readonly TestRunner.TestResult[],
): readonly FailureRecord.FailedTestEvidence[] =>
  tests.filter((test): test is TestRunner.FailedTestResult => test.status === 'failed').map(failedTestEvidenceOf)

const decide = (command: DryRunObservation): Result.Result<DryRunObservationDecision, never> =>
  Match.value(command.dryRunResult).pipe(
    Match.discriminator('status')('complete', (complete) =>
      Result.succeed(
        DryRunObservedComplete.make({
          testCount: complete.tests.length,
          failedTestCount: complete.tests.filter((test) => test.status === 'failed').length,
          failedTests: failedTestEvidencesOf(complete.tests),
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
