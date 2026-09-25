import { Workflow } from '@systemfsoftware/effect-cell-types'
import * as Match from 'effect/Match'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

export class DryRunError extends S.TaggedError<DryRunError>()('DryRunError', {
  stage: S.Literals(['dryRun', 'dryRunNoTests']),
  reason: S.String,
}) {}

export class FailedTestSummary extends S.Class<FailedTestSummary>('FailedTestSummary')({
  name: S.String,
  failureMessage: S.String,
}) {}

export class DryRunCommand extends S.TaggedClass<DryRunCommand>()('DryRunCommand', {
  status: S.Literals(['Complete', 'Error', 'Timeout']),
  testCount: S.Finite,
  failedTestCount: S.Finite,
  failedTests: S.Array(FailedTestSummary),
  allowEmpty: S.Boolean,
  errorMessage: S.optional(S.String),
  reason: S.optional(S.String),
}) {
  static readonly [Workflow.InstrumentationBrand] = {
    status: 'stryker.dry_run.status',
    testCount: 'stryker.dry_run.test_count',
    failedTestCount: 'stryker.dry_run.failed_test_count',
    allowEmpty: 'stryker.dry_run.allow_empty',
  } as const
}

const DryRunDecisionTypeId: unique symbol = Symbol.for('@systemfsoftware/stryker-js/DryRunDecision')
type DryRunDecisionTypeId = typeof DryRunDecisionTypeId

export class DryRunPassed extends S.TaggedClass<DryRunPassed>()('DryRunPassed', {
  testCount: S.Finite,
}) {
  readonly [DryRunDecisionTypeId] = DryRunDecisionTypeId
}

export class DryRunFailed extends S.TaggedClass<DryRunFailed>()('DryRunFailed', {
  testCount: S.Finite,
  failedTestCount: S.Finite,
  failedTests: S.Array(FailedTestSummary),
}) {
  readonly [DryRunDecisionTypeId] = DryRunDecisionTypeId
}

export type DryRunDecision = DryRunPassed | DryRunFailed

type CompleteOutcome = 'noTests' | 'failed' | 'passed'

const completeOutcomeOf = (command: DryRunCommand): CompleteOutcome =>
  Match.value(command).pipe(
    Match.when({ testCount: 0, allowEmpty: false }, (): CompleteOutcome => 'noTests'),
    Match.when({ failedTestCount: (count: number): boolean => count > 0 }, (): CompleteOutcome => 'failed'),
    Match.orElse((): CompleteOutcome => 'passed'),
  )

const decideComplete = (command: DryRunCommand): Result.Result<DryRunDecision, DryRunError> =>
  Match.value({
    outcome: completeOutcomeOf(command),
    testCount: command.testCount,
    failedTestCount: command.failedTestCount,
    failedTests: command.failedTests,
  }).pipe(
    Match.when({ outcome: 'noTests' }, () =>
      Result.fail(
        DryRunError.make({
          stage: 'dryRunNoTests',
          reason: 'No tests were executed. Stryker will exit prematurely. Please check your configuration.',
        }),
      )),
    Match.when({ outcome: 'failed' }, ({ testCount, failedTestCount, failedTests }) =>
      Result.succeed(
        DryRunFailed.make({
          testCount,
          failedTestCount,
          failedTests,
        }),
      )),
    Match.when({ outcome: 'passed' }, ({ testCount }) =>
      Result.succeed(
        DryRunPassed.make({
          testCount,
        }),
      )),
    Match.exhaustive,
  )

const reasonOrDefault = (reason: string | undefined, fallback: string): string =>
  Match.value(reason).pipe(
    Match.when(undefined, () => fallback),
    Match.orElse((present) => present),
  )

const decide = (command: DryRunCommand): Result.Result<DryRunDecision, DryRunError> =>
  Match.value(command.status).pipe(
    Match.when('Error', () =>
      Result.fail(
        DryRunError.make({
          stage: 'dryRun',
          reason: reasonOrDefault(command.errorMessage, 'Dry run error'),
        }),
      )),
    Match.when('Timeout', () =>
      Result.fail(
        DryRunError.make({
          stage: 'dryRun',
          reason: reasonOrDefault(command.reason, 'Initial test run timed out'),
        }),
      )),
    Match.when('Complete', () => decideComplete(command)),
    Match.exhaustive,
  )
export const dryRun = Workflow.make({
  command: DryRunCommand,
  decision: S.Union([DryRunPassed, DryRunFailed]),
  error: DryRunError,
  decide,
})
