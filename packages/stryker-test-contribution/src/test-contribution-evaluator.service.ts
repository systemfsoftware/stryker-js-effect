import { Evaluator, type Plugin, type Report } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import * as Match from 'effect/Match'
import * as Result from 'effect/Result'
import { JudgeTestContribution, judgeTestContribution } from './judge-test-contribution.workflow.js'

const EXIT_VERDICT_FAIL: Plugin.ExitClass = 'VerdictFail'
const VERDICT_FAIL_NOTE =
  '(sharpen or delete them, or remove the test-contribution plugin from `plugins` to prevent this error in the future)'

export const makeTestContributionEvaluatorService = (options: {
  readonly disableBail: boolean
}): {
  readonly evaluate: (
    report: Report.MutationTestResult,
  ) => Effect.Effect<Plugin.ExitClass | null, Evaluator.EvaluatorFailed>
} => ({
  evaluate: (report) =>
    Effect.flatMap(
      Effect.try({
        try: () =>
          judgeTestContribution(
            JudgeTestContribution.make({
              report,
              everyKillerRecorded: options.disableBail === true,
              suffixes: JudgeTestContribution.defaultRequireTestContributionSuffixes,
            }),
          ).pipe(Result.merge),
        catch: (cause) => Evaluator.EvaluatorFailed.make({ cause }),
      }),
      (verdict) =>
        Match.value(verdict.failed).pipe(
          Match.when(true, () =>
            Effect.as(
              Effect.andThen(
                Effect.logError(`${verdict.message}\nSetting exit code to 1 (failure).`),
                () => Effect.logInfo(VERDICT_FAIL_NOTE),
              ),
              EXIT_VERDICT_FAIL,
            )),
          Match.when(false, () => Effect.as(Effect.logInfo(verdict.message), null)),
          Match.exhaustive,
        ),
    ),
})

export const testContributionEvaluatorLayer = (
  options: {
    readonly disableBail: boolean
  },
): Layer.Layer<Evaluator.Evaluator> => Layer.succeed(Evaluator.Evaluator, makeTestContributionEvaluatorService(options))
