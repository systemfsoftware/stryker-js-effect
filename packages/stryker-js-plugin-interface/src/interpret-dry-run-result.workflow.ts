import { Workflow } from '@systemfsoftware/effect-cell-types'
import { DryRunResultSchema, type FailedTestResult, type TestResult } from './TestRunner.schema.js'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

const MutantRunDecisionTypeId: unique symbol = Symbol.for('@systemfsoftware/stryker-js-plugin-interface/MutantRunDecision')
type MutantRunDecisionTypeId = typeof MutantRunDecisionTypeId

export class MutantRunErrored extends S.TaggedClass<MutantRunErrored>()('Error', {
  errorMessage: S.String,
}) {
  readonly [MutantRunDecisionTypeId] = MutantRunDecisionTypeId
}

export class MutantRunKilled extends S.TaggedClass<MutantRunKilled>()('Killed', {
  failureMessage: S.String,
  killedBy: S.Array(S.String),
  nrOfTests: S.Finite,
}) {
  readonly [MutantRunDecisionTypeId] = MutantRunDecisionTypeId
}

export class MutantRunSurvived extends S.TaggedClass<MutantRunSurvived>()('Survived', {
  nrOfTests: S.Finite,
}) {
  readonly [MutantRunDecisionTypeId] = MutantRunDecisionTypeId
}

export class MutantRunTimedOut extends S.TaggedClass<MutantRunTimedOut>()('Timeout', {
  reason: S.optional(S.String),
}) {
  readonly [MutantRunDecisionTypeId] = MutantRunDecisionTypeId
}

export type MutantRunDecision = MutantRunErrored | MutantRunKilled | MutantRunSurvived | MutantRunTimedOut

export class InterpretDryRunResultCommand extends S.TaggedClass<InterpretDryRunResultCommand>()(
  'InterpretDryRunResultCommand',
  { dryRunResult: DryRunResultSchema },
) {
  static readonly [Workflow.InstrumentationBrand] = {} as const
}

const failedTestsOf = (tests: readonly TestResult[]) =>
  tests.filter((test): test is FailedTestResult => test.status === 'failed')

const countedTestsOf = (tests: readonly TestResult[]) => tests.filter((test) => test.status !== 'skipped').length

const firstFailedTestOf = (failed: readonly FailedTestResult[]) => Option.fromUndefinedOr(failed.at(0))

const decide = (command: InterpretDryRunResultCommand) =>
  Match.value(command.dryRunResult).pipe(
    Match.discriminator('status')('complete', (complete) => {
      const failed = failedTestsOf(complete.tests)
      const nrOfTests = countedTestsOf(complete.tests)
      return Option.match(firstFailedTestOf(failed), {
        onNone: (): Result.Result<MutantRunDecision> => Result.succeed(MutantRunSurvived.make({ nrOfTests })),
        onSome: (firstFailed): Result.Result<MutantRunDecision> =>
          Result.succeed(MutantRunKilled.make({
            failureMessage: firstFailed.failureMessage,
            killedBy: failed.map((test) => test.id),
            nrOfTests,
          })),
      })
    }),
    Match.discriminator('status')('error', (errored) =>
      Result.succeed(MutantRunErrored.make({ errorMessage: errored.errorMessage }))),
    Match.discriminator('status')('timeout', (timedOut) =>
      Option.match(Option.fromUndefinedOr(timedOut.reason), {
        onNone: () => Result.succeed(MutantRunTimedOut.make({})),
        onSome: (reason) => Result.succeed(MutantRunTimedOut.make({ reason })),
      })),
    Match.exhaustive,
  )

export const interpretDryRunResult = Workflow.make({
  command: InterpretDryRunResultCommand,
  decision: S.Union([MutantRunErrored, MutantRunKilled, MutantRunSurvived, MutantRunTimedOut]),
  error: S.Never,
  decide,
})
